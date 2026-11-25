const crypto = require("node:crypto");
const fs = require("node:fs");
const config = require("./config");
const { AppError } = require("./errors");
const { isMongoReady } = require("./db");
const { Application } = require("./models");

function parseKey(value) {
  const [algorithm, N, r, p, salt, digest] = String(value || "").split("$");
  if (algorithm !== "scrypt" || !N || !r || !p || !salt || !digest) return null;
  return { N: Number(N), r: Number(r), p: Number(p), salt, digest };
}

function hashApiKey(apiKey) {
  if (!apiKey || typeof apiKey !== "string") throw new Error("API key inválida");
  const salt = crypto.randomBytes(16).toString("hex");
  const N = 16384;
  const r = 8;
  const p = 1;
  const digest = crypto.scryptSync(apiKey, salt, 64, { N, r, p }).toString("hex");
  return `scrypt$${N}$${r}$${p}$${salt}$${digest}`;
}

function matchesHash(apiKey, encodedHash) {
  const parsed = parseKey(encodedHash);
  if (!parsed || !Number.isSafeInteger(parsed.N) || !Number.isSafeInteger(parsed.r) || !Number.isSafeInteger(parsed.p)) return false;
  try {
    const digest = crypto.scryptSync(apiKey, parsed.salt, 64, { N: parsed.N, r: parsed.r, p: parsed.p }).toString("hex");
    return crypto.timingSafeEqual(Buffer.from(digest, "hex"), Buffer.from(parsed.digest, "hex"));
  } catch {
    return false;
  }
}

function readJsonKeyStore() {
  let store;
  try {
    store = JSON.parse(fs.readFileSync(config.apiKeyStore, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw new AppError(500, "Não foi possível carregar a configuração de acesso", "AUTH_STORE_ERROR");
  }
  if (!Array.isArray(store.keys)) throw new AppError(500, "Configuração de acesso inválida", "AUTH_STORE_INVALID");
  return store.keys;
}

function mergeKeyStores(keys, applications) {
  const mongoById = new Map(applications.map((application) => [application.id, application]));
  const fallbackKeys = keys.filter((key) => {
    const application = mongoById.get(key.id);
    if (!application) return true;
    return application.enabled !== false && (application.apiKeyHashes || []).includes(key.keyHash);
  });
  const mongoKeys = applications.filter((application) => application.enabled !== false).flatMap((application) => (application.apiKeyHashes || []).map((keyHash) => ({
    id: application.id,
    role: application.role || "application",
    keyHash,
    applications: [application.id],
    sessions: application.allowedSessionIds || [],
    permissions: application.permissions || [],
  })));
  return [...fallbackKeys, ...mongoKeys];
}

async function readKeyStore() {
  const keys = readJsonKeyStore();
  if (!isMongoReady()) {
    if (!keys.length) throw new AppError(503, "Nenhuma chave de API foi configurada", "AUTH_NOT_CONFIGURED");
    return keys;
  }
  const applications = await Application.find({}).lean();
  return mergeKeyStores(keys, applications);
}

function getCredentials(req) {
  const header = req.get("x-api-key") || req.get("authorization");
  if (!header) return null;
  return header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : header.trim();
}

function allows(value, requested) {
  return Array.isArray(value) && (value.includes("*") || value.includes(requested));
}

function requireApiKey(options = {}) {
  return async (req, res, next) => {
    try {
    const apiKey = getCredentials(req);
    if (!apiKey) return next(new AppError(401, "API key obrigatória", "AUTH_REQUIRED"));

    const requestedApplicationId = req.get("x-application-id");
    const sessionId = req.get("x-whatsapp-session") || req.query.session || config.defaultSession;
    const principal = (await readKeyStore()).find((entry) => entry.enabled !== false && matchesHash(apiKey, entry.keyHash));
    if (!principal) return next(new AppError(401, "API key inválida", "AUTH_INVALID"));
    const applicationId = requestedApplicationId || (principal.role === "admin" && principal.applications?.length === 1 && principal.applications[0] !== "*" ? principal.applications[0] : "default");
    if (!allows(principal.applications, applicationId)) return next(new AppError(403, "Aplicação não autorizada", "APP_FORBIDDEN"));
    if (!allows(principal.sessions, sessionId)) return next(new AppError(403, "Sessão não autorizada", "SESSION_FORBIDDEN"));
    if (options.admin && principal.role !== "admin") return next(new AppError(403, "Acesso administrativo necessário", "ADMIN_FORBIDDEN"));

    req.auth = { id: principal.id, role: principal.role || "application", applicationId, sessionId, allowedSessionIds: principal.sessions || [], permissions: principal.permissions || [] };
    return next();
    } catch (error) {
      return next(error);
    }
  };
}

function requireSessionAccess(req, sessionId) {
  if (req.auth?.role === "admin" && req.auth.allowedSessionIds.includes("*")) return;
  if (!req.auth?.allowedSessionIds.includes("*") && !req.auth?.allowedSessionIds.includes(sessionId)) {
    throw new AppError(403, "Sessão não autorizada", "SESSION_FORBIDDEN");
  }
}

module.exports = { hashApiKey, matchesHash, requireApiKey, requireSessionAccess, readKeyStore, mergeKeyStores };
