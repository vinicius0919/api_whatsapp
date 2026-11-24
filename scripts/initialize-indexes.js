const { connectMongo, disconnectMongo, mongoose } = require("../src/db");
const { inspectIndexes, createDeclaredIndexes } = require("../src/indexes");

function printReport(report) {
  console.log(`MongoDB database=${mongoose.connection.name} host=${mongoose.connection.host}`);
  for (const item of report.reports) {
    console.log(`${item.model}: atuais=${item.actual.map((index) => index.name).join(", ") || "nenhum"}`);
  }
  console.log(`Índices ausentes: ${report.missing.length}`);
  console.log(`Conflitos de definição: ${report.conflicts.length}`);
  for (const conflict of report.conflicts) {
    console.log(`Conflito ${conflict.model}: esperado=${conflict.expected.name} atual=${conflict.actual.name}`);
  }
}

async function main(argv = process.argv.slice(2)) {
  const apply = argv.includes("--apply");
  const known = new Set(["--dry-run", "--apply"]);
  const unknown = argv.find((arg) => !known.has(arg));
  if (unknown) throw new Error(`Argumento desconhecido: ${unknown}`);
  await connectMongo();
  try {
    let report = await inspectIndexes();
    printReport(report);
    if (!apply) {
      console.log("Dry-run concluído: nenhum índice ou documento foi alterado.");
      return;
    }
    if (report.conflicts.length > 0) throw new Error("Existem índices incompatíveis; execute a migração específica correspondente antes do provisionamento");
    report = await createDeclaredIndexes();
    printReport(report);
    if (report.missing.length > 0 || report.conflicts.length > 0) throw new Error("Provisionamento não foi verificado integralmente");
    console.log("Provisionamento concluído sem alteração de documentos.");
  } finally {
    await disconnectMongo();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Falha no provisionamento de índices: ${error.name || "Error"} ${error.code || "INDEX_INITIALIZATION_ERROR"}`);
    disconnectMongo().catch(() => {});
    process.exitCode = 1;
  });
}

module.exports = { main, printReport };
