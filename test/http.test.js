const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "api-whatsapp-http-"));
process.env.API_KEY_STORE = path.join(tempDir, "api-keys.json");
process.env.RATE_LIMIT_MAX = "120";
process.env.MESSAGE_RATE_LIMIT_MAX = "30";
process.env.WHATSAPP_AUTH_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "api-whatsapp-http-auth-"));
process.env.WHATSAPP_SESSION_AUTH_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "api-whatsapp-http-sessions-"));
process.env.WHATSAPP_SESSION_LOCK_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "api-whatsapp-http-locks-"));

const { hashApiKey } = require("../src/auth");
const keys = {
  admin: "admin-test-key",
  app: "app-test-key",
  other: "other-test-key",
};
fs.writeFileSync(process.env.API_KEY_STORE, JSON.stringify({ keys: [
  { id: "admin", role: "admin", keyHash: hashApiKey(keys.admin), applications: ["*"], sessions: ["*"] },
  { id: "app", role: "application", keyHash: hashApiKey(keys.app), applications: ["billing"], sessions: ["default"] },
  { id: "other", role: "application", keyHash: hashApiKey(keys.other), applications: ["other"], sessions: ["secondary"] },
] }));

const request = require("supertest");
const app = require("../src/app");
const whatsapp = require("../src/whatsapp");

function auth(key = keys.app, application = "billing", session = "default") {
  return { "x-api-key": key, "x-application-id": application, "x-whatsapp-session": session };
}

function connectedSocket() {
  return {
    sent: [],
    async sendMessage(jid, message) {
      this.sent.push({ jid, message });
      return { key: { id: "message-id" } };
    },
    async groupFetchAllParticipating() {
      return { "123@g.us": { id: "123@g.us", subject: "Grupo teste" } };
    },
  };
}

test("health informa WhatsApp desconectado e conectado", async () => {
  whatsapp.setSessionForTests("default", { state: "disconnected", socket: null });
  assert.equal((await request(app).get("/health")).status, 200);
  assert.equal((await request(app).get("/ready")).status, 503);
  whatsapp.setSessionForTests("default", { state: "connected", socket: connectedSocket() });
  assert.equal((await request(app).get("/health")).status, 200);
  assert.equal((await request(app).get("/ready")).status, 503);
});

test("painel administrativo é same-origin e exige autenticação administrativa", async () => {
  const page = await request(app).get("/admin");
  assert.equal(page.status, 200);
  assert.match(page.headers["content-security-policy"], /default-src 'self'/);
  assert.equal(page.headers["cache-control"], "no-store");
  assert.equal((await request(app).get("/admin/api/auth")).status, 401);
  assert.equal((await request(app).get("/admin/api/auth").set(auth(keys.app, "billing"))).status, 403);
  assert.equal((await request(app).get("/admin/api/auth").set(auth(keys.admin, "admin"))).status, 200);
});

test("rejeita ausência e invalidade de API key", async () => {
  assert.equal((await request(app).get("/groups")).status, 401);
  assert.equal((await request(app).get("/groups").set(auth("wrong"))).status, 401);
});

test("isola aplicação, sessão e acesso administrativo", async () => {
  assert.equal((await request(app).get("/groups").set(auth(keys.app, "other"))).status, 403);
  assert.equal((await request(app).get("/groups").set(auth(keys.app, "billing", "secondary"))).status, 403);
  assert.equal((await request(app).get("/qr").set(auth())).status, 403);
  assert.notEqual((await request(app).get("/qr").set(auth(keys.admin, "admin"))).status, 401);
});

test("lista grupos e envia mensagens com socket mockado", async () => {
  const socket = connectedSocket();
  whatsapp.setSessionForTests("default", { state: "connected", socket });
  assert.deepEqual((await request(app).get("/groups").set(auth())).body, [{ id: "123@g.us", subject: "Grupo teste" }]);
  assert.equal((await request(app).post("/messages/send").set(auth()).send({ number: "5511999999999", message: "Olá" })).status, 200);
  assert.equal((await request(app).post("/groups/send").set(auth()).send({ number: "123@g.us", message: "Olá grupo" })).status, 200);
  assert.equal(socket.sent.length, 2);
});

test("retorna o identificador real da mensagem enviada", async () => {
  const socket = connectedSocket();
  whatsapp.setSessionForTests("default", { state: "connected", socket });
  const response = await request(app).post("/api/v1/messages/text").set(auth()).send({ to: "5511999999999", text: "Identificador real" });
  assert.equal(response.status, 201);
  assert.equal(response.body.messageId, "message-id");
  assert.equal(response.body.chatId, "5511999999999@s.whatsapp.net");
  assert.equal(response.body.status, "sent");
});

test("não inventa identificador quando o Baileys não retorna a chave", async () => {
  whatsapp.setSessionForTests("default", { state: "connected", socket: { async sendMessage() { return {}; } } });
  const response = await request(app).post("/api/v1/messages/text").set(auth()).send({ to: "5511999999999", text: "Sem ID" });
  assert.equal(response.status, 502);
  assert.equal(response.body.error, "WHATSAPP_MESSAGE_ID_MISSING");
});

test("valida payload, desconexão e falha de envio", async () => {
  whatsapp.setSessionForTests("default", { state: "disconnected", socket: null });
  assert.equal((await request(app).post("/messages/send").set(auth()).send({ number: "abc", message: "x" })).status, 400);
  assert.equal((await request(app).post("/messages/send").set(auth()).send({ number: "5511999999999", message: "x" })).status, 503);
  whatsapp.setSessionForTests("default", { state: "connected", socket: { async sendMessage() { throw new Error("simulated failure"); } } });
  const response = await request(app).post("/messages/send").set(auth()).send({ number: "5511999999999", message: "x" });
  assert.equal(response.status, 500);
  assert.equal(response.body.error, "INTERNAL_ERROR");
});

test("expõe API v1 de sessões e mensagens sem quebrar o contrato legado", async () => {
  const created = await request(app).post("/api/v1/sessions").set(auth(keys.admin, "gateway-admin", "default")).send({ id: "v1-test", name: "Sessão V1" });
  assert.equal(created.status, 201);
  assert.equal(created.body.id, "v1-test");
  assert.equal((await request(app).get("/api/v1/sessions/v1-test").set(auth(keys.admin, "gateway-admin", "default"))).status, 200);
  assert.equal((await request(app).get("/api/v1/sessions/v1-test").set(auth())).status, 403);

  whatsapp.setSessionForTests("default", { state: "connected", socket: connectedSocket() });
  const response = await request(app).post("/api/v1/messages/text").set(auth()).send({ sessionId: "default", to: "5511999999999", text: "Olá V1" });
  assert.equal(response.status, 201);
  assert.equal(response.body.status, "sent");
});

test("aplica rate limiting", async () => {
  let limited = false;
  for (let i = 0; i < 130; i += 1) {
    const response = await request(app).get("/health");
    if (response.status === 429) {
      limited = true;
      break;
    }
  }
  assert.equal(limited, true);
});
