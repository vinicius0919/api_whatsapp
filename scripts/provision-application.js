const { connectMongo, disconnectMongo } = require("../src/db");
const { Application } = require("../src/models");
const { hashApiKey, matchesHash } = require("../src/auth");

function required(name) {
  const value = process.env[name];
  if (!value || !value.trim()) throw new Error(`${name} é obrigatória`);
  return value.trim();
}

function list(name, fallback = "") {
  return String(process.env[name] || fallback).split(",").map((item) => item.trim()).filter(Boolean);
}

function sameList(left = [], right = []) {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

async function main() {
  const apply = process.argv.includes("--apply");
  const allowScopeChange = process.argv.includes("--allow-scope-change");
  const id = required("APPLICATION_ID");
  const name = process.env.APPLICATION_NAME?.trim() || id;
  const apiKey = required("APPLICATION_API_KEY");
  const role = process.env.APPLICATION_ROLE?.trim() || "application";
  if (!["application", "admin"].includes(role)) throw new Error("APPLICATION_ROLE deve ser application ou admin");
  const allowedSessionIds = list("APPLICATION_SESSIONS", "default");
  const permissions = list("APPLICATION_PERMISSIONS");
  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", applicationId: id, role, sessions: allowedSessionIds, permissions }));
  if (!apply) return;

  await connectMongo();
  const existing = await Application.findOne({ id }).lean();
  if (existing && !allowScopeChange && ((existing.role || "application") !== role || !sameList(existing.allowedSessionIds, allowedSessionIds) || !sameList(existing.permissions, permissions))) {
    throw new Error("Aplicação existente possui escopo diferente; use --allow-scope-change após revisão explícita");
  }
  const keyAlreadyProvisioned = (existing?.apiKeyHashes || []).some((encodedHash) => matchesHash(apiKey, encodedHash));
  const update = {
    $set: { name, role, enabled: true, allowedSessionIds, permissions },
  };
  if (!keyAlreadyProvisioned) update.$addToSet = { apiKeyHashes: hashApiKey(apiKey) };
  await Application.findOneAndUpdate(
    { id },
    update,
    { upsert: true, setDefaultsOnInsert: true, runValidators: true }
  );
  console.log(JSON.stringify({ status: keyAlreadyProvisioned ? "already_provisioned" : "provisioned", applicationId: id }));
  await disconnectMongo();
}

main().catch(async (error) => {
  console.error("Falha ao provisionar aplicação", { name: error.name, code: error.code, message: error.message });
  await disconnectMongo();
  process.exitCode = 1;
});
