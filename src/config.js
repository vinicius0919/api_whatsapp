const path = require("node:path");
const dotenv = require("dotenv");

dotenv.config();

function requiredString(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (!value || !String(value).trim()) {
    throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  }
  return String(value).trim();
}

function positiveInteger(name, fallback) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Variável ${name} deve ser um inteiro positivo`);
  }
  return value;
}

function nonNegativeInteger(name, fallback) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Variável ${name} deve ser um inteiro não negativo`);
  }
  return value;
}

function monitorGroups(value) {
  const groups = String(value || "").split(",").map((id) => id.trim()).filter(Boolean);
  if (groups.some((id) => !/^\d+@g\.us$/.test(id))) {
    throw new Error("WHATSAPP_MONITORED_GROUPS deve conter somente JIDs de grupo válidos");
  }
  return Object.freeze(groups);
}

function monitorMode(value) {
  const mode = String(value || "all").trim().toLowerCase();
  if (!["all", "allowlist", "none"].includes(mode)) {
    throw new Error("WHATSAPP_MONITOR_MODE deve ser all, allowlist ou none");
  }
  return mode;
}

function booleanFlag(value) {
  return String(value || "false").trim().toLowerCase() === "true";
}

const rootDir = path.resolve(__dirname, "..");

const config = Object.freeze({
  env: process.env.NODE_ENV || "development",
  port: positiveInteger("PORT", 3000),
  defaultSession: requiredString("WHATSAPP_DEFAULT_SESSION", "default"),
  defaultApplicationId: requiredString("WHATSAPP_DEFAULT_APPLICATION_ID", "default"),
  whatsappAutoConnect: process.env.WHATSAPP_AUTO_CONNECT === "true",
  monitorMode: monitorMode(process.env.WHATSAPP_MONITOR_MODE),
  monitoredGroups: monitorGroups(process.env.WHATSAPP_MONITORED_GROUPS),
  debugInbound: booleanFlag(process.env.WHATSAPP_DEBUG_INBOUND),
  authDir: path.resolve(rootDir, process.env.WHATSAPP_AUTH_DIR || "auth"),
  sessionAuthRoot: path.resolve(rootDir, process.env.WHATSAPP_SESSION_AUTH_ROOT || "auth-sessions"),
  sessionLockRoot: path.resolve(rootDir, process.env.WHATSAPP_SESSION_LOCK_ROOT || ".session-locks"),
  apiKeyStore: path.resolve(rootDir, process.env.API_KEY_STORE || "config/api-keys.json"),
  mongoUri: requiredString("MONGODB_URI", "mongodb://127.0.0.1:27017/api_whatsapp"),
  mongoServerSelectionTimeoutMs: positiveInteger("MONGODB_SERVER_SELECTION_TIMEOUT_MS", 5000),
  rateLimitWindowMs: positiveInteger("RATE_LIMIT_WINDOW_MS", 15 * 60 * 1000),
  rateLimitMax: positiveInteger("RATE_LIMIT_MAX", 120),
  messageRateLimitMax: positiveInteger("MESSAGE_RATE_LIMIT_MAX", 30),
  reconnectBaseDelayMs: positiveInteger("RECONNECT_BASE_DELAY_MS", 1000),
  reconnectMaxDelayMs: positiveInteger("RECONNECT_MAX_DELAY_MS", 30000),
  reconnectMaxAttempts: nonNegativeInteger("RECONNECT_MAX_ATTEMPTS", 0),
  sessionIdPattern: /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/,
  corsOrigin: process.env.CORS_ORIGIN || "http://localhost:3000",
  webhookAllowLocalTest: process.env.NODE_ENV !== "production" && booleanFlag(process.env.WEBHOOK_ALLOW_LOCAL_TEST),
  webhookTestHost: process.env.WEBHOOK_TEST_HOST || "127.0.0.1",
  webhookTestPort: positiveInteger("WEBHOOK_TEST_PORT", 3004),
});

module.exports = config;
