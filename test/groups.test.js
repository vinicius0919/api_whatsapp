const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeJid } = require("../routes/groups");

test("normaliza números e preserva JIDs válidos", () => {
  assert.equal(normalizeJid("5511999999999"), "5511999999999@s.whatsapp.net");
  assert.equal(normalizeJid("5511999999999@s.whatsapp.net"), "5511999999999@s.whatsapp.net");
  assert.equal(normalizeJid("123456789@g.us"), "123456789@g.us");
});

test("rejeita JID inválido", () => {
  assert.throws(() => normalizeJid("não-é-jid"), /JID inválido/);
});
