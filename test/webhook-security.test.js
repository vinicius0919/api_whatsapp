const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const path = require("node:path");

process.env.WEBHOOK_ENCRYPTION_KEY = "test-webhook-encryption-key";
const { encryptSecret, decryptSecret, signPayload, safeEqual, validateWebhookUrl } = require("../src/webhooks/security");

test("protege segredo de webhook e assina payload", () => {
  const encrypted = encryptSecret("webhook-secret-value");
  assert.notEqual(encrypted, "webhook-secret-value");
  assert.equal(decryptSecret(encrypted), "webhook-secret-value");
  const signature = signPayload("webhook-secret-value", "{}", "2026-11-23T12:00:00.000Z", "evt_1");
  assert.equal(safeEqual(signature, signature), true);
  assert.equal(safeEqual(signature, `${signature}x`), false);
});

test("bloque destinos de webhook inseguros", async () => {
  await assert.rejects(() => validateWebhookUrl("http://example.com"), /HTTPS/);
  await assert.rejects(() => validateWebhookUrl("https://127.0.0.1"), /não permitido/);
});

test("permite somente o receptor local explicitamente habilitado fora de produção", () => {
  const cwd = path.resolve(__dirname, "..");
  const script = "const { validateWebhookUrl } = require('./src/webhooks/security'); validateWebhookUrl('http://127.0.0.1:3000/webhooks/whatsapp', { allowLocalTest: true }).then(() => process.stdout.write('ok')).catch((error) => process.stdout.write(error.code));";
  const enabled = execFileSync(process.execPath, ["-e", script], { cwd, env: { ...process.env, NODE_ENV: "test", WEBHOOK_ALLOW_LOCAL_TEST: "true", WEBHOOK_LOCAL_TEST_HOST: "127.0.0.1", WEBHOOK_LOCAL_TEST_PORT: "3000", WEBHOOK_LOCAL_TEST_PATH: "/webhooks/whatsapp" }, encoding: "utf8" });
  assert.equal(enabled.trim().split("\n").at(-1), "ok");
  const production = execFileSync(process.execPath, ["-e", script], { cwd, env: { ...process.env, NODE_ENV: "production", WEBHOOK_ALLOW_LOCAL_TEST: "true", WEBHOOK_LOCAL_TEST_HOST: "127.0.0.1", WEBHOOK_LOCAL_TEST_PORT: "3000", WEBHOOK_LOCAL_TEST_PATH: "/webhooks/whatsapp" }, encoding: "utf8" });
  assert.match(production.trim().split("\n").at(-1), /WEBHOOK_HTTPS_REQUIRED|WEBHOOK_DESTINATION_BLOCKED/);
});

test("aceita somente o destino local direto configurado", async () => {
  await assert.rejects(() => validateWebhookUrl("http://127.0.0.1:3000/webhook", { allowLocalTest: true }), /HTTPS/);
  await assert.rejects(() => validateWebhookUrl("http://127.0.0.1:3001/webhooks/whatsapp", { allowLocalTest: true }), /HTTPS/);
});

test("restringe subscriptions de mensagens à allowlist do Gateway", () => {
  const cwd = path.resolve(__dirname, "..");
  const script = "const { validateChatScope } = require('./src/services/webhookService'); try { validateChatScope(JSON.parse(process.argv[1]), ['message.received']); process.stdout.write('ok'); } catch (error) { process.stdout.write(error.code); }";
  const env = { ...process.env, NODE_ENV: "test", WHATSAPP_MONITOR_MODE: "allowlist", WHATSAPP_MONITORED_GROUPS: "120363432779760997@g.us" };
  const allowed = execFileSync(process.execPath, ["-e", script, JSON.stringify(["120363432779760997@g.us"])], { cwd, env, encoding: "utf8" });
  const denied = execFileSync(process.execPath, ["-e", script, JSON.stringify(["999999@g.us"])], { cwd, env, encoding: "utf8" });
  assert.equal(allowed.trim().split("\n").at(-1), "ok");
  assert.equal(denied.trim().split("\n").at(-1), "WEBHOOK_CHAT_NOT_ALLOWED");
});
