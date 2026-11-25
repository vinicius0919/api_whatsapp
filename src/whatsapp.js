const path = require("node:path");
const fs = require("node:fs");
const pino = require("pino");
require("./logging");
const qrcodeTerminal = require("qrcode-terminal");
const QRCode = require("qrcode");
const config = require("./config");
const { AppError } = require("./errors");
const { Message, Session } = require("./models");
const { isMongoReady } = require("./db");
const { eventDispatcher } = require("./events/dispatcher");
const { normalizeMessage } = require("./messages/normalize");
const { shouldMonitorMessage } = require("./messages/monitor");
const { inboundDebug, safeErrorSummary } = require("./messages/debug");

const activeLockPaths = new Set();

function isMessageIdentityDuplicateError(error) {
  const keyPattern = error?.keyPattern || {};
  const indexName = typeof error?.index === "string" ? error.index : "";
  return Boolean(keyPattern.sessionId && keyPattern.whatsappMessageId)
    || indexName.includes("sessionId_1_whatsappMessageId_1");
}

class SessionManager {
  constructor() {
    this.sessions = new Map();
    this.baileys = null;
  }

  validateId(id) {
    if (typeof id !== "string" || !config.sessionIdPattern.test(id)) {
      throw new AppError(400, "ID de sessão inválido", "INVALID_SESSION_ID");
    }
    return id;
  }

  authPath(id) {
    this.validateId(id);
    return id === config.defaultSession ? config.authDir : path.join(config.sessionAuthRoot, id);
  }

  lockPath(id) { return path.join(config.sessionLockRoot, `${id}.lock`); }

  acquireLock(session) {
    fs.mkdirSync(config.sessionLockRoot, { recursive: true });
    const lockPath = this.lockPath(session.id);
    if (activeLockPaths.has(lockPath)) {
      throw new AppError(409, "Sessão já está sendo usada por outro processo", "SESSION_LOCKED");
    }
    try {
      session.lockFd = fs.openSync(lockPath, "wx");
      fs.writeFileSync(session.lockFd, String(process.pid));
      activeLockPaths.add(lockPath);
      return;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    let ownerPid = 0;
    try { ownerPid = Number(fs.readFileSync(lockPath, "utf8")); } catch {}
    let lockActive = activeLockPaths.has(lockPath);
    if (!lockActive && ownerPid > 0 && ownerPid !== process.pid) {
      try {
        process.kill(ownerPid, 0);
        lockActive = true;
      } catch {}
    }
    if (lockActive) throw new AppError(409, "Sessão já está sendo usada por outro processo", "SESSION_LOCKED");
    fs.rmSync(lockPath, { force: true });
    session.lockFd = fs.openSync(lockPath, "wx");
    fs.writeFileSync(session.lockFd, String(process.pid));
    activeLockPaths.add(lockPath);
  }

  releaseLock(session) {
    if (session.lockFd === undefined) return;
    try { fs.closeSync(session.lockFd); } catch {}
    session.lockFd = undefined;
    const lockPath = this.lockPath(session.id);
    activeLockPaths.delete(lockPath);
    fs.rmSync(lockPath, { force: true });
  }

  entry(id) {
    const session = this.sessions.get(this.validateId(id));
    if (!session) throw new AppError(404, "Sessão não encontrada", "SESSION_NOT_FOUND");
    return session;
  }

  async persistSession(session) {
    if (!isMongoReady()) return;
    await Session.findOneAndUpdate({ id: session.id }, {
      id: session.id,
      name: session.name,
      ownerApplicationId: session.ownerApplicationId,
      enabled: session.enabled,
      status: session.state,
      authStoragePath: session.authPath,
      ...(session.state === "connected" ? { lastConnectedAt: new Date() } : {}),
      ...(session.state === "disconnected" || session.state === "logged_out" ? { lastDisconnectedAt: new Date() } : {}),
    }, { upsert: true, new: true, setDefaultsOnInsert: true });
  }

  async createSession({ id, name, ownerApplicationId, enabled = true }) {
    this.validateId(id);
    if (id === config.defaultSession) throw new AppError(409, "A sessão padrão legada é reservada", "DEFAULT_SESSION_RESERVED");
    if (!name || typeof name !== "string") throw new AppError(400, "Nome da sessão é obrigatório", "INVALID_SESSION_NAME");
    if (!ownerApplicationId || typeof ownerApplicationId !== "string") throw new AppError(400, "Aplicação proprietária é obrigatória", "INVALID_OWNER_APPLICATION");
    if (this.sessions.has(id)) throw new AppError(409, "Sessão já existe", "SESSION_EXISTS");
    const session = { id, name, ownerApplicationId, enabled, authPath: this.authPath(id), socket: null, state: "created", qr: null, connectPromise: null, reconnectTimer: null, reconnectAttempt: 0, closed: false };
    this.sessions.set(id, session);
    await this.persistSession(session);
    return this.status(session);
  }

  async loadPersistedSessions() {
    if (!isMongoReady()) return;
    const persisted = await Session.find({ enabled: true }).lean();
    for (const item of persisted) {
      this.validateId(item.id);
      if (!this.sessions.has(item.id)) {
        const ownerApplicationId = item.id === config.defaultSession && item.ownerApplicationId === "system"
          ? config.defaultApplicationId
          : item.ownerApplicationId;
        this.sessions.set(item.id, { id: item.id, name: item.name, ownerApplicationId, enabled: item.enabled, authPath: this.authPath(item.id), socket: null, state: item.status || "created", qr: null, connectPromise: null, reconnectTimer: null, reconnectAttempt: 0, closed: false });
      }
    }
  }

  ensureDefaultSession() {
    if (!this.sessions.has(config.defaultSession)) {
      this.sessions.set(config.defaultSession, { id: config.defaultSession, name: "Default", ownerApplicationId: config.defaultApplicationId, enabled: true, authPath: this.authPath(config.defaultSession), socket: null, state: "created", qr: null, connectPromise: null, reconnectTimer: null, reconnectAttempt: 0, closed: false });
    }
    return this.sessions.get(config.defaultSession);
  }

  async loadBaileys() {
    if (!this.baileys) this.baileys = await import("@whiskeysockets/baileys");
    return this.baileys;
  }

  async connectSession(id) {
    const session = id === config.defaultSession && !this.sessions.has(id) ? this.ensureDefaultSession() : this.entry(id);
    if (!session.enabled) throw new AppError(409, "Sessão desabilitada", "SESSION_DISABLED");
    if (session.connectPromise) return session.connectPromise;
    if (session.state === "connected" && session.socket) return session.socket;
    session.closed = false;
    session.state = session.reconnectAttempt ? "reconnecting" : "connecting";
    session.connectPromise = (async () => {
      this.acquireLock(session);
      await this.persistSession(session);
      const { makeWASocket, useMultiFileAuthState } = await this.loadBaileys();
      const { state, saveCreds } = await useMultiFileAuthState(session.authPath);
      const socket = makeWASocket({ auth: state, logger: pino({ level: "silent" }) });
      session.socket = socket;
      socket.ev.on("creds.update", async (creds) => {
        await saveCreds(creds);
        await eventDispatcher.publish({ type: "session.credentials_updated", sessionId: id, data: { sessionId: id } });
      });
      socket.ev.on("connection.update", (update) => this.handleConnectionUpdate(session, socket, update));
      socket.ev.on("messages.upsert", (update) => {
        if (session.socket === socket) return this.handleMessagesUpsert(session, update);
        inboundDebug("Event ignored", { sessionId: id, reason: "STALE_SOCKET" });
        return undefined;
      });
      socket.ev.on("messages.update", (updates) => this.handleMessagesUpdate(session, updates));
      inboundDebug("Listener registered", { sessionId: id });
      return socket;
    })().catch(async (error) => {
      session.state = "error";
      session.socket = null;
      session.connectPromise = null;
      this.releaseLock(session);
      await this.persistSession(session);
      throw error;
    });
    return session.connectPromise;
  }

  async handleConnectionUpdate(session, socket, { connection, lastDisconnect, qr }) {
    if (session.closed || session.socket !== socket) return;
    if (qr) {
      session.state = "qr_required";
      session.qr = await QRCode.toDataURL(qr);
      qrcodeTerminal.generate(qr, { small: true });
      await this.persistSession(session);
      await eventDispatcher.publish({ type: "session.qr_required", sessionId: session.id, data: { sessionId: session.id } });
    }
    if (connection === "open") {
      session.state = "connected";
      session.qr = null;
      session.reconnectAttempt = 0;
      await this.persistSession(session);
      await eventDispatcher.publish({ type: "session.connected", sessionId: session.id, data: { sessionId: session.id } });
    }
    if (connection === "close") {
      session.socket = null;
      session.connectPromise = null;
      session.qr = null;
      const reason = lastDisconnect?.error?.output?.statusCode;
      if (reason === this.baileys?.DisconnectReason?.loggedOut) {
        session.state = "logged_out";
        this.releaseLock(session);
        await this.persistSession(session);
        await eventDispatcher.publish({ type: "session.logged_out", sessionId: session.id, data: { sessionId: session.id } });
        return;
      }
      this.releaseLock(session);
      session.state = "reconnecting";
      await this.persistSession(session);
      await eventDispatcher.publish({ type: "session.disconnected", sessionId: session.id, data: { sessionId: session.id, reason: "connection_closed" } });
      this.scheduleReconnect(session);
    }
  }

  scheduleReconnect(session) {
    if (session.closed || session.reconnectTimer) return;
    if (config.reconnectMaxAttempts > 0 && session.reconnectAttempt >= config.reconnectMaxAttempts) {
      session.state = "disconnected";
      this.persistSession(session).catch(() => {});
      return;
    }
    const delay = Math.min(config.reconnectBaseDelayMs * (2 ** session.reconnectAttempt), config.reconnectMaxDelayMs);
    const jitter = Math.floor(Math.random() * Math.max(1, Math.floor(delay * 0.2)));
    session.reconnectAttempt += 1;
    session.reconnectTimer = setTimeout(() => {
      session.reconnectTimer = null;
      if (!session.closed) this.connectSession(session.id).catch((error) => console.error("Falha ao reconectar WhatsApp", error.message));
    }, delay + jitter);
  }

  async handleMessagesUpsert(session, update) {
    const messages = Array.isArray(update?.messages) ? update.messages : [];
    inboundDebug("Event received", { sessionId: session.id, type: update?.type || "unknown", count: messages.length });
    if (update?.type !== "notify") {
      inboundDebug("Event ignored", { sessionId: session.id, reason: "NON_NOTIFY_EVENT", type: update?.type || "unknown" });
      return;
    }
    for (const message of messages) {
      const preliminary = {
        sessionId: session.id,
        messageId: message?.key?.id,
        chatId: message?.key?.remoteJid,
        isGroup: typeof message?.key?.remoteJid === "string" && message.key.remoteJid.endsWith("@g.us"),
        fromMe: Boolean(message?.key?.fromMe),
      };
      inboundDebug("Message detected", preliminary);
      try {
        let normalized;
        try {
          normalized = normalizeMessage(message);
        } catch (error) {
          inboundDebug("Normalization error", { ...preliminary, sessionId: session.id, code: error.code, errorCategory: error.name || "Error" });
          throw error;
        }
        inboundDebug("Normalization successful", { ...normalized, sessionId: session.id });
        if (!normalized.messageId) {
          inboundDebug("Message ignored", { ...preliminary, reason: "MESSAGE_ID_MISSING" });
          continue;
        }
        const monitored = this.shouldMonitor(normalized);
        inboundDebug("Monitor result", { ...normalized, sessionId: session.id, accepted: monitored });
        if (!monitored) {
          const reason = normalized.fromMe
            ? "FROM_ME"
            : config.monitorMode === "none"
              ? "MONITOR_MODE_NONE"
              : config.monitorMode === "allowlist" && !normalized.isGroup
                ? "PRIVATE_CHAT_NOT_ALLOWED"
                : config.monitorMode === "allowlist"
                  ? "GROUP_NOT_ALLOWED"
                  : "MONITOR_FILTER_REJECTED";
          inboundDebug("Message ignored", { ...normalized, sessionId: session.id, reason });
          continue;
        }
        await this.processMessage(session, message, update?.type, normalized);
      } catch (error) {
        inboundDebug("Processing error", { ...preliminary, sessionId: session.id, ...safeErrorSummary(error) });
        console.error("Falha ao processar mensagem recebida", { sessionId: session.id, ...safeErrorSummary(error) });
      }
    }
  }

  shouldMonitor(normalized) {
    return shouldMonitorMessage(normalized, { mode: config.monitorMode, groups: config.monitoredGroups });
  }

  async processMessage(session, message, updateType, normalized = normalizeMessage(message)) {
    if (!normalized.messageId) throw new AppError(422, "Mensagem recebida sem identificador WhatsApp", "MESSAGE_ID_MISSING");
    normalized.history = updateType && updateType !== "notify";
    const record = { sessionId: session.id, applicationId: session.ownerApplicationId, direction: normalized.fromMe ? "outbound" : "inbound", ...normalized, whatsappMessageId: normalized.messageId, status: normalized.fromMe ? "sent" : "accepted" };
    record.content = normalized.content;
    delete record.messageId;
    delete record.history;
    const mongoConnected = isMongoReady();
    inboundDebug("MongoDB state", { sessionId: session.id, ...normalized, connected: mongoConnected });
    if (!mongoConnected) {
      inboundDebug("Persistence error", { sessionId: session.id, ...normalized, errorName: "MongoNotReady", reason: "MONGODB_NOT_READY" });
      throw new AppError(503, "MongoDB não está conectado", "MONGODB_NOT_CONNECTED");
    }
    let duplicate = false;
    try {
      await Message.create(record);
    } catch (error) {
      if (error.code !== 11000) {
        inboundDebug("Persistence error", { sessionId: session.id, ...normalized, ...safeErrorSummary(error) });
        throw error;
      }
      if (!isMessageIdentityDuplicateError(error)) {
        inboundDebug("Persistence error", { sessionId: session.id, ...normalized, ...safeErrorSummary(error), reason: "DUPLICATE_KEY_NOT_MESSAGE_ID" });
        throw error;
      }
      const existing = await Message.findOne({ sessionId: session.id, whatsappMessageId: normalized.messageId }).select("_id").lean();
      if (!existing) {
        inboundDebug("Persistence error", { sessionId: session.id, ...normalized, ...safeErrorSummary(error), reason: "DUPLICATE_WITHOUT_DOCUMENT" });
        throw error;
      }
      duplicate = true;
    }
    inboundDebug("Message persisted", { sessionId: session.id, ...normalized, duplicate });
    const { content, ...eventData } = normalized;
    await eventDispatcher.publish({ type: normalized.fromMe ? "message.sent" : "message.received", sessionId: session.id, eventId: `msg_${session.id}_${normalized.messageId}`, data: { sessionId: session.id, ...eventData, direction: record.direction } });
    inboundDebug("Event published", { sessionId: session.id, ...normalized, eventType: normalized.fromMe ? "message.sent" : "message.received" });
  }

  async handleMessagesUpdate(session, updates) {
    for (const update of Array.isArray(updates) ? updates : []) {
      await eventDispatcher.publish({ type: "message.updated", sessionId: session.id, data: { messageId: update?.key?.id, update } });
    }
  }

  status(session) {
    return { id: session.id, name: session.name, ownerApplicationId: session.ownerApplicationId, enabled: session.enabled, status: session.state, hasQr: Boolean(session.qr), authStoragePath: session.authPath };
  }

  getSessionStatus(id) { return this.status(id === config.defaultSession && !this.sessions.has(id) ? this.ensureDefaultSession() : this.entry(id)); }
  getSessionQr(id) { return (id === config.defaultSession && !this.sessions.has(id) ? this.ensureDefaultSession() : this.entry(id)).qr; }
  getSocket(id = config.defaultSession) { const session = id === config.defaultSession && !this.sessions.has(id) ? this.ensureDefaultSession() : this.entry(id); if (!session.socket || session.state !== "connected") throw new AppError(503, "WhatsApp ainda não está conectado", "WHATSAPP_NOT_CONNECTED"); return session.socket; }
  listSessions() { return [...this.sessions.values()].map((session) => this.status(session)); }

  async disconnectSession(id) {
    const session = this.entry(id);
    session.closed = true;
    if (session.reconnectTimer) clearTimeout(session.reconnectTimer);
    session.reconnectTimer = null;
    if (session.socket?.end) await session.socket.end();
    this.releaseLock(session);
    session.socket = null;
    session.connectPromise = null;
    session.qr = null;
    session.state = "disconnected";
    await this.persistSession(session);
    await eventDispatcher.publish({ type: "session.disconnected", sessionId: id, data: { sessionId: id, reason: "manual_disconnect" } });
    return this.status(session);
  }

  async shutdownAll() {
    await Promise.all([...this.sessions.keys()].map((id) => this.disconnectSession(id).catch(() => {})));
    for (const session of this.sessions.values()) session.state = "stopped";
  }

  setBaileysForTests(mock) { this.baileys = mock; }
  setSessionForTests(id, values) { this.sessions.set(id, { id, name: id, ownerApplicationId: "test", enabled: true, authPath: this.authPath(id), socket: null, state: "created", qr: null, connectPromise: null, reconnectTimer: null, reconnectAttempt: 0, closed: false, ...values }); }
  resetSessionsForTests() { for (const session of this.sessions.values()) this.releaseLock(session); this.sessions.clear(); }
}

const sessionManager = new SessionManager();

async function connectWhatsApp(id = config.defaultSession) { return sessionManager.connectSession(id); }
function getSocket(id = config.defaultSession) { return sessionManager.getSocket(id); }
async function getGroups(id = config.defaultSession) { const groups = await getSocket(id).groupFetchAllParticipating(); return Object.values(groups).map((group) => ({ id: group.id, subject: group.subject })); }
function getSessionStatus(id = config.defaultSession) { const status = sessionManager.getSessionStatus(id); return { session: status.id, state: status.status, hasQr: status.hasQr }; }
function getLastQr(id = config.defaultSession) { return sessionManager.getSessionQr(id); }
async function closeWhatsApp() { return sessionManager.shutdownAll(); }

module.exports = { SessionManager, sessionManager, connectWhatsApp, getSocket, getGroups, getLastQr, getSessionStatus, closeWhatsApp, isMessageIdentityDuplicateError, loadPersistedSessions: () => sessionManager.loadPersistedSessions(), setBaileysForTests: (mock) => sessionManager.setBaileysForTests(mock), setSessionForTests: (id, values) => sessionManager.setSessionForTests(id, values), resetSessionsForTests: () => sessionManager.resetSessionsForTests() };
