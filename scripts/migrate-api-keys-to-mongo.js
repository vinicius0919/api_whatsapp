const fs = require("node:fs");
const config = require("../src/config");
const { connectMongo, disconnectMongo } = require("../src/db");
const { Application } = require("../src/models");

async function main() {
  const store = JSON.parse(fs.readFileSync(config.apiKeyStore, "utf8"));
  await connectMongo();
  for (const key of store.keys || []) {
    await Application.findOneAndUpdate({ id: key.id }, {
      id: key.id,
      name: key.id,
      role: key.role === "admin" ? "admin" : "application",
      enabled: key.enabled !== false,
      permissions: key.permissions || [],
      allowedSessionIds: key.sessions || [],
      apiKeyHashes: key.keyHash ? [key.keyHash] : [],
    }, { upsert: true, setDefaultsOnInsert: true });
  }
  await disconnectMongo();
}

main().catch(async (error) => {
  console.error("Falha na migração", error.message);
  await disconnectMongo();
  process.exitCode = 1;
});
