const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

process.env.RECONNECT_BASE_DELAY_MS = "10";
process.env.RECONNECT_MAX_DELAY_MS = "40";
process.env.WHATSAPP_AUTH_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "api-whatsapp-auth-"));
process.env.WHATSAPP_SESSION_AUTH_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "api-whatsapp-sessions-"));
process.env.WHATSAPP_SESSION_LOCK_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "api-whatsapp-locks-"));

const whatsapp = require("../src/whatsapp");

function mockSocket() {
  const handlers = new Map();
  return {
    handlers,
    ev: {
      on(event, handler) { handlers.set(event, handler); },
    },
    async end() { this.ended = true; },
  };
}

test("inicializa uma única conexão, persiste credenciais e processa QR/open", async () => {
  whatsapp.resetSessionsForTests();
  let authCalls = 0;
  let socketCalls = 0;
  let savedCreds = 0;
  const socket = mockSocket();
  whatsapp.setBaileysForTests({
    DisconnectReason: { loggedOut: 401 },
    async useMultiFileAuthState() { authCalls += 1; return { state: {}, saveCreds: async () => { savedCreds += 1; } }; },
    makeWASocket() { socketCalls += 1; return socket; },
  });

  const [first, second] = await Promise.all([whatsapp.connectWhatsApp("default"), whatsapp.connectWhatsApp("default")]);
  assert.equal(first, second);
  assert.equal(authCalls, 1);
  assert.equal(socketCalls, 1);
  await socket.handlers.get("creds.update")({ updated: true });
  assert.equal(savedCreds, 1);

  await socket.handlers.get("connection.update")({ qr: "qr-value" });
  assert.match(whatsapp.getLastQr("default"), /^data:image\/png;base64,/);
  await socket.handlers.get("connection.update")({ connection: "open" });
  assert.deepEqual(whatsapp.getSessionStatus("default"), { session: "default", state: "connected", hasQr: false });
});

test("faz backoff na desconexão e evita reconexão duplicada", async () => {
  whatsapp.resetSessionsForTests();
  const sockets = [];
  whatsapp.setBaileysForTests({
    DisconnectReason: { loggedOut: 401 },
    async useMultiFileAuthState() { return { state: {}, saveCreds: async () => {} }; },
    makeWASocket() { const socket = mockSocket(); sockets.push(socket); return socket; },
  });
  await whatsapp.connectWhatsApp("default");
  const close = sockets[0].handlers.get("connection.update");
  await close({ connection: "close", lastDisconnect: { error: { output: { statusCode: 500 } } } });
  assert.equal(whatsapp.getSessionStatus("default").state, "reconnecting");
  const firstTimerStatus = whatsapp.getSessionStatus("default");
  await close({ connection: "close", lastDisconnect: { error: { output: { statusCode: 500 } } } });
  assert.equal(whatsapp.getSessionStatus("default").state, firstTimerStatus.state);
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(sockets.length, 2);
  await whatsapp.closeWhatsApp();
});

test("distingue logout e encerra sockets com segurança", async () => {
  whatsapp.resetSessionsForTests();
  const socket = mockSocket();
  whatsapp.setBaileysForTests({
    DisconnectReason: { loggedOut: 401 },
    async useMultiFileAuthState() { return { state: {}, saveCreds: async () => {} }; },
    makeWASocket() { return socket; },
  });
  await whatsapp.connectWhatsApp("default");
  await socket.handlers.get("connection.update")({ connection: "close", lastDisconnect: { error: { output: { statusCode: 401 } } } });
  assert.equal(whatsapp.getSessionStatus("default").state, "logged_out");
  whatsapp.setSessionForTests("default", { socket, state: "connected" });
  await whatsapp.closeWhatsApp();
  assert.equal(socket.ended, true);
  assert.equal(whatsapp.getSessionStatus("default").state, "stopped");
});

test("mantém sessões independentes e normaliza mensagem recebida", async () => {
  whatsapp.resetSessionsForTests();
  const sockets = [];
  const events = [];
  const unsubscribe = require("../src/events/dispatcher").eventDispatcher.on((event) => events.push(event));
  whatsapp.setBaileysForTests({
    DisconnectReason: { loggedOut: 401 },
    async useMultiFileAuthState() { return { state: {}, saveCreds: async () => {} }; },
    makeWASocket() { const socket = mockSocket(); sockets.push(socket); return socket; },
  });
  await whatsapp.sessionManager.createSession({ id: "alpha", name: "Alpha", ownerApplicationId: "app-alpha" });
  await whatsapp.sessionManager.createSession({ id: "beta", name: "Beta", ownerApplicationId: "app-beta" });
  await Promise.all([whatsapp.connectWhatsApp("alpha"), whatsapp.connectWhatsApp("beta")]);
  assert.equal(sockets.length, 2);
  await sockets[0].handlers.get("messages.upsert")({ type: "notify", messages: [{ key: { id: "m1", remoteJid: "120363432779760997@g.us", participant: "5511999999999@s.whatsapp.net", fromMe: false }, message: { extendedTextMessage: { text: "Olá", contextInfo: { stanzaId: "original-1", participant: "5511888888888@s.whatsapp.net", quotedMessage: { conversation: "Original" } } } }, messageTimestamp: 1700000000 }] });
  assert.equal(events.some((event) => event.type === "message.received" && event.sessionId === "alpha"), false);
  assert.equal(whatsapp.getSessionStatus("beta").state, "connecting");
  unsubscribe();
  await whatsapp.closeWhatsApp();
});

test("recupera lock obsoleto e bloqueia outro proprietário", async () => {
  const { SessionManager } = whatsapp;
  const first = new SessionManager();
  const second = new SessionManager();
  const socket = mockSocket();
  const baileys = {
    DisconnectReason: { loggedOut: 401 },
    async useMultiFileAuthState() { return { state: {}, saveCreds: async () => {} }; },
    makeWASocket() { return socket; },
  };
  first.setBaileysForTests(baileys);
  second.setBaileysForTests(baileys);
  first.setSessionForTests("lock-test", { authPath: path.join(process.env.WHATSAPP_SESSION_AUTH_ROOT, "lock-test") });
  second.setSessionForTests("lock-test", { authPath: path.join(process.env.WHATSAPP_SESSION_AUTH_ROOT, "lock-test") });
  fs.mkdirSync(process.env.WHATSAPP_SESSION_LOCK_ROOT, { recursive: true });
  fs.writeFileSync(path.join(process.env.WHATSAPP_SESSION_LOCK_ROOT, "lock-test.lock"), "2147483647");
  await first.connectSession("lock-test");
  await assert.rejects(second.connectSession("lock-test"), (error) => error.code === "SESSION_LOCKED");
  await first.disconnectSession("lock-test");
});

test("ignora histórico sincronizado e mensagens da própria conta", async () => {
  const { SessionManager } = whatsapp;
  const manager = new SessionManager();
  const session = { id: "default" };
  let processed = 0;
  manager.processMessage = async () => { processed += 1; };

  await manager.handleMessagesUpsert(session, {
    type: "append",
    messages: [{ key: { id: "history-1", remoteJid: "120363@g.us", fromMe: false }, message: { conversation: "histórico" } }],
  });
  await manager.handleMessagesUpsert(session, {
    type: "notify",
    messages: [{ key: { id: "self-1", remoteJid: "120363@g.us", fromMe: true }, message: { conversation: "própria" } }],
  });

  assert.equal(processed, 0);
});
