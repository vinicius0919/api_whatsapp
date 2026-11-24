const crypto = require("node:crypto");
const dns = require("node:dns").promises;
const net = require("node:net");
const config = require("../config");
const { AppError } = require("../errors");

function encryptionKey() {
  if (!process.env.WEBHOOK_ENCRYPTION_KEY) throw new AppError(503, "WEBHOOK_ENCRYPTION_KEY não configurada", "WEBHOOK_SECRET_NOT_CONFIGURED");
  return crypto.createHash("sha256").update(process.env.WEBHOOK_ENCRYPTION_KEY).digest();
}

function encryptSecret(secret) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString("base64url")).join(".");
}

function decryptSecret(value) {
  const [iv, tag, ciphertext] = String(value).split(".").map((part) => Buffer.from(part, "base64url"));
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

function isPrivateAddress(address) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split(".").map(Number);
    return a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a === 0;
  }
  if (net.isIPv6(address)) return address === "::1" || address === "::" || address.startsWith("fc") || address.startsWith("fd") || address.startsWith("fe8") || address.startsWith("fe9") || address.startsWith("fea") || address.startsWith("feb");
  return true;
}

function isAllowedLocalTestUrl(url) {
  return url.protocol === "http:"
    && url.hostname === "127.0.0.1"
    && Number(url.port || 80) === config.webhookTestPort
    && url.pathname === "/webhook"
    && !url.username
    && !url.password
    && !url.search
    && !url.hash;
}

async function validateWebhookUrl(value, { allowLocalTest = false } = {}) {
  let url;
  try { url = new URL(value); } catch { throw new AppError(400, "URL de webhook inválida", "INVALID_WEBHOOK_URL"); }
  if (allowLocalTest && config.webhookAllowLocalTest && isAllowedLocalTestUrl(url)) return url.toString();
  if (url.protocol !== "https:") throw new AppError(400, "Webhook deve usar HTTPS", "WEBHOOK_HTTPS_REQUIRED");
  let addresses;
  try { addresses = await dns.lookup(url.hostname, { all: true, verbatim: true }); } catch { throw new AppError(400, "Destino de webhook não resolvível", "WEBHOOK_DNS_ERROR"); }
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) throw new AppError(400, "Destino de webhook não permitido", "WEBHOOK_DESTINATION_BLOCKED");
  return url.toString();
}

function signPayload(secret, body, timestamp, eventId) {
  return crypto.createHmac("sha256", secret).update(`${timestamp}.${eventId}.${body}`).digest("hex");
}

function safeEqual(left, right) {
  const a = Buffer.from(left || "", "utf8");
  const b = Buffer.from(right || "", "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { encryptSecret, decryptSecret, validateWebhookUrl, signPayload, safeEqual, isAllowedLocalTestUrl };
