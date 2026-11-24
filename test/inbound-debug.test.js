const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const path = require("node:path");

test("debug inbound permanece desativado por padrão e aceita true", () => {
  const cwd = path.resolve(__dirname, "..");
  const script = "process.stdout.write(String(require('./src/config').debugInbound))";
  const baseEnv = { ...process.env, WHATSAPP_DEBUG_INBOUND: "false" };
  assert.equal(execFileSync(process.execPath, ["-e", script], { cwd, env: baseEnv, encoding: "utf8" }).trim().split("\n").at(-1), "false");
  assert.equal(execFileSync(process.execPath, ["-e", script], { cwd, env: { ...baseEnv, WHATSAPP_DEBUG_INBOUND: "true" }, encoding: "utf8" }).trim().split("\n").at(-1), "true");
});

test("debug inbound não expõe identificadores de chats fora da allowlist", () => {
  const cwd = path.resolve(__dirname, "..");
  const script = "const { inboundDebug } = require('./src/messages/debug'); inboundDebug('Normalization successful', { messageId: 'secret-id', chatId: '999@g.us', remoteJid: '999@g.us', senderJid: '5511999999999@s.whatsapp.net', displayName: 'Pessoa privada', quotedMessage: { text: 'citação privada' }, text: 'segredo' });";
  const output = execFileSync(process.execPath, ["-e", script], {
    cwd,
    env: { ...process.env, WHATSAPP_DEBUG_INBOUND: "true", WHATSAPP_MONITOR_MODE: "allowlist", WHATSAPP_MONITORED_GROUPS: "120363432779760997@g.us" },
    encoding: "utf8",
  });
  assert.doesNotMatch(output, /secret-id|999@g\.us|5511999999999|Pessoa privada|citação privada|segredo/);
});
