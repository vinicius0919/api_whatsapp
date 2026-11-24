const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const { shouldMonitorMessage } = require("../src/messages/monitor");

const base = { messageId: "m1", isGroup: true, chatId: "120363432779760997@g.us", fromMe: false };

test("allowlist monitora somente o grupo configurado", () => {
  assert.equal(shouldMonitorMessage(base, { mode: "allowlist", groups: [base.chatId] }), true);
  assert.equal(shouldMonitorMessage({ ...base, chatId: "outro@g.us" }, { mode: "allowlist", groups: [base.chatId] }), false);
  assert.equal(shouldMonitorMessage({ ...base, isGroup: false, chatId: "5511999999999@s.whatsapp.net" }, { mode: "allowlist", groups: [base.chatId] }), false);
});

test("none desativa e all preserva conversas privadas", () => {
  const privateMessage = { ...base, isGroup: false, chatId: "5511999999999@s.whatsapp.net" };
  assert.equal(shouldMonitorMessage(privateMessage, { mode: "none" }), false);
  assert.equal(shouldMonitorMessage(privateMessage, { mode: "all" }), true);
});

test("mensagem própria nunca é tratada como recebida", () => {
  assert.equal(shouldMonitorMessage({ ...base, fromMe: true }, { mode: "all" }), false);
  assert.equal(shouldMonitorMessage({ ...base, fromMe: true }, { mode: "allowlist", groups: [base.chatId] }), false);
});

test("configuração de monitoramento inválida falha antes da inicialização", () => {
  const cwd = path.resolve(__dirname, "..");
  assert.throws(() => execFileSync(process.execPath, ["-e", "require('./src/config')"], {
    cwd,
    env: { ...process.env, WHATSAPP_MONITOR_MODE: "invalid" },
    stdio: "ignore",
  }));
  assert.throws(() => execFileSync(process.execPath, ["-e", "require('./src/config')"], {
    cwd,
    env: { ...process.env, WHATSAPP_MONITOR_MODE: "allowlist", WHATSAPP_MONITORED_GROUPS: "not-a-group" },
    stdio: "ignore",
  }));
});
