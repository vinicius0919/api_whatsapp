const test = require("node:test");
const assert = require("node:assert/strict");
const { hashApiKey, matchesHash } = require("../src/auth");

test("API key é armazenada como hash verificável", () => {
  const hash = hashApiKey("chave-de-teste");
  assert.match(hash, /^scrypt\$16384\$8\$1\$/);
  assert.equal(matchesHash("chave-de-teste", hash), true);
  assert.equal(matchesHash("chave-incorreta", hash), false);
});

test("não reativa no JSON uma credencial revogada no MongoDB", () => {
  const { mergeKeyStores } = require("../src/auth");
  const revokedHash = hashApiKey("revogada");
  const activeHash = hashApiKey("atualizada");
  const merged = mergeKeyStores([{ id: "billing", keyHash: revokedHash, applications: ["billing"], sessions: ["default"] }], [{ id: "billing", enabled: true, apiKeyHashes: [activeHash] }]);
  assert.equal(merged.some((entry) => entry.keyHash === revokedHash), false);
  assert.equal(merged.some((entry) => entry.keyHash === activeHash), true);
});

test("preserva o papel administrativo provisionado no MongoDB", () => {
  const { mergeKeyStores } = require("../src/auth");
  const adminHash = hashApiKey("admin-do-painel");
  const merged = mergeKeyStores([], [{ id: "gateway-admin", role: "admin", enabled: true, apiKeyHashes: [adminHash], allowedSessionIds: ["default"] }]);
  assert.equal(merged[0].role, "admin");
  assert.deepEqual(merged[0].sessions, ["default"]);
});
