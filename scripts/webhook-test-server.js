const http = require("node:http");
const crypto = require("node:crypto");
const { signPayload, safeEqual } = require("../src/webhooks/security");

const DEFAULT_TOLERANCE_MS = 5 * 60 * 1000;

function createWebhookTestServer({
  secret = process.env.WEBHOOK_TEST_SECRET || "webhook-test-secret-123456",
  host = process.env.WEBHOOK_TEST_RECEIVER_HOST || "127.0.0.1",
  port = Number(process.env.WEBHOOK_TEST_RECEIVER_PORT || 3104),
  toleranceMs = Number(process.env.WEBHOOK_TEST_TIMESTAMP_TOLERANCE_MS || DEFAULT_TOLERANCE_MS),
} = {}) {
  const received = [];
  const eventIds = new Set();

  function log(message, details = {}) {
    console.log(`[WEBHOOK TEST] ${message}`, JSON.stringify(details));
  }

  function validateTimestamp(value) {
    const timestamp = Date.parse(value || "");
    return Number.isFinite(timestamp) && Math.abs(Date.now() - timestamp) <= toleranceMs;
  }

  function sendJson(res, statusCode, body) {
    const payload = JSON.stringify(body);
    res.writeHead(statusCode, { "content-type": "application/json", "content-length": Buffer.byteLength(payload) });
    res.end(payload);
  }

  const server = http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      return sendJson(res, 200, { status: "ok", received: received.length, duplicates: received.filter((item) => item.duplicate).length });
    }
    if (req.method !== "POST" || req.url !== "/webhook") return sendJson(res, 404, { error: "NOT_FOUND" });

    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size <= 1024 * 1024) chunks.push(chunk);
    });
    req.on("end", () => {
      if (size > 1024 * 1024) return sendJson(res, 413, { error: "PAYLOAD_TOO_LARGE" });
      const body = Buffer.concat(chunks).toString("utf8");
      const timestamp = req.headers["x-webhook-timestamp"];
      const eventId = req.headers["x-webhook-event-id"];
      const signature = String(req.headers["x-webhook-signature"] || "");
      const expected = `sha256=${signPayload(secret, body, timestamp, eventId)}`;
      if (!timestamp || !validateTimestamp(timestamp)) return sendJson(res, 400, { error: "INVALID_TIMESTAMP" });
      if (!signature.startsWith("sha256=") || !safeEqual(signature, expected)) return sendJson(res, 401, { error: "INVALID_SIGNATURE" });

      let event;
      try { event = JSON.parse(body); } catch { return sendJson(res, 400, { error: "INVALID_JSON" }); }
      const duplicate = eventIds.has(eventId);
      eventIds.add(eventId);
      received.push({ eventId, type: event.type, duplicate, payload: event });
      log(duplicate ? "Evento duplicado recebido" : "Evento recebido", { eventId, type: event.type, sessionId: event.sessionId });
      return sendJson(res, 200, { ok: true, duplicate });
    });
    return undefined;
  });

  return {
    server,
    received,
    eventIds,
    listen() { return new Promise((resolve, reject) => server.listen(port, host, () => resolve(server.address())) .once("error", reject)); },
    close() { return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); },
  };
}

if (require.main === module) {
  const instance = createWebhookTestServer();
  instance.listen().then((address) => {
    console.log(`[WEBHOOK TEST] Receptor ouvindo em http://${address.address}:${address.port}/webhook`);
  }).catch((error) => {
    console.error("Falha ao iniciar receptor de teste", { code: error.code, name: error.name });
    process.exitCode = 1;
  });
  const shutdown = () => instance.close().catch(() => {}).finally(() => process.exit(0));
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

module.exports = { createWebhookTestServer };
