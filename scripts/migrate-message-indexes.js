const { connectMongo, disconnectMongo, mongoose } = require("../src/db");
const { Message } = require("../src/models");

const TARGET_INDEX = "sessionId_1_applicationId_1_idempotencyKey_1_partial";
const QUOTED_TEXT_INDEX = "quotedMessage_text";

function hasKeys(index, expected) {
  return JSON.stringify(index.key) === JSON.stringify(expected);
}

function isPartialIdempotencyIndex(index) {
  return hasKeys(index, { sessionId: 1, applicationId: 1, idempotencyKey: 1 })
    && index.unique === true
    && index.partialFilterExpression?.idempotencyKey?.$type === "string";
}

function isLegacyIdempotencyIndex(index) {
  return hasKeys(index, { sessionId: 1, applicationId: 1, idempotencyKey: 1 })
    && index.unique === true
    && index.sparse === true
    && !index.partialFilterExpression;
}

async function listIndexes() {
  return Message.collection.listIndexes().toArray();
}

async function countDuplicateIdempotencyKeys() {
  const duplicates = await Message.aggregate([
    { $match: { idempotencyKey: { $type: "string" } } },
    { $group: { _id: { sessionId: "$sessionId", applicationId: "$applicationId", idempotencyKey: "$idempotencyKey" }, count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
    { $count: "groups" },
  ]);
  return duplicates[0]?.groups || 0;
}

async function countWithoutStringIdempotencyKey() {
  const result = await Message.aggregate([
    { $match: { $expr: { $ne: [{ $type: "$idempotencyKey" }, "string"] } } },
    { $count: "documents" },
  ]);
  return result[0]?.documents || 0;
}

function printReport({ indexes, duplicateGroups, withoutStringKey, quotedTextIndex }) {
  const legacy = indexes.filter(isLegacyIdempotencyIndex);
  const partial = indexes.filter(isPartialIdempotencyIndex);
  console.log(`MongoDB database=${mongoose.connection.name} host=${mongoose.connection.host}`);
  console.log(`Índices atuais: ${indexes.map((index) => index.name).join(", ") || "nenhum"}`);
  console.log(`Índice sparse legado: ${legacy.map((index) => index.name).join(", ") || "não encontrado"}`);
  console.log(`Índice parcial correto: ${partial.map((index) => index.name).join(", ") || "não encontrado"}`);
  console.log(`Grupos duplicados por idempotencyKey: ${duplicateGroups}`);
  console.log(`Documentos sem idempotencyKey string: ${withoutStringKey}`);
  console.log(`Índice de texto ${QUOTED_TEXT_INDEX}: ${quotedTextIndex ? "encontrado" : "não encontrado"}`);
  console.log(`Proposta: criar/verificar ${TARGET_INDEX} e remover somente o índice sparse legado identificado.`);
  if (quotedTextIndex) console.log(`Remoção de ${QUOTED_TEXT_INDEX}: somente com --drop-quoted-text-index --apply.`);
}

async function inspect() {
  const indexes = await listIndexes();
  const duplicateGroups = await countDuplicateIdempotencyKeys();
  const withoutStringKey = await countWithoutStringIdempotencyKey();
  const quotedTextIndex = indexes.some((index) => index.name === QUOTED_TEXT_INDEX);
  return { indexes, duplicateGroups, withoutStringKey, quotedTextIndex };
}

async function applyMigration({ dropQuotedTextIndex = false } = {}) {
  let report = await inspect();
  printReport(report);
  if (report.duplicateGroups > 0) throw new Error("Migração interrompida: existem conflitos de idempotencyKey");

  const legacyIndexes = report.indexes.filter(isLegacyIdempotencyIndex);
  const partialIndex = report.indexes.find(isPartialIdempotencyIndex);
  if (!partialIndex) {
    await Message.collection.createIndex(
      { sessionId: 1, applicationId: 1, idempotencyKey: 1 },
      { name: TARGET_INDEX, unique: true, partialFilterExpression: { idempotencyKey: { $type: "string" } } },
    );
  }

  report = await inspect();
  if (!report.indexes.some(isPartialIdempotencyIndex)) throw new Error("Migração interrompida: índice parcial não foi verificado");
  for (const index of legacyIndexes) await Message.collection.dropIndex(index.name);
  if (dropQuotedTextIndex && report.quotedTextIndex) await Message.collection.dropIndex(QUOTED_TEXT_INDEX);
  report = await inspect();
  printReport(report);
  console.log("Migração concluída sem alteração de documentos.");
}

async function main(argv = process.argv.slice(2)) {
  const apply = argv.includes("--apply");
  const dropQuotedTextIndex = argv.includes("--drop-quoted-text-index");
  const known = new Set(["--dry-run", "--apply", "--drop-quoted-text-index"]);
  const unknown = argv.find((arg) => !known.has(arg));
  if (unknown) throw new Error(`Argumento desconhecido: ${unknown}`);
  if (dropQuotedTextIndex && !apply) throw new Error("--drop-quoted-text-index exige --apply");
  await connectMongo();
  try {
    const report = await inspect();
    printReport(report);
    if (apply) await applyMigration({ dropQuotedTextIndex });
    else console.log("Dry-run concluído: nenhum índice ou documento foi alterado.");
  } finally {
    await disconnectMongo();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Falha na migração de índices: ${error.name || "Error"} ${error.code || "MIGRATION_ERROR"}`);
    disconnectMongo().catch(() => {});
    process.exitCode = 1;
  });
}

module.exports = { TARGET_INDEX, isPartialIdempotencyIndex, isLegacyIdempotencyIndex, countDuplicateIdempotencyKeys, countWithoutStringIdempotencyKey, inspect, applyMigration, main };
