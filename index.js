const app = require("./src/app");
const { connectWhatsApp, closeWhatsApp, loadPersistedSessions } = require("./src/whatsapp");
const config = require("./src/config");
const { connectMongo, disconnectMongo } = require("./src/db");
const { webhookDispatcher } = require("./src/webhooks/dispatcher");

async function start() {
  await connectMongo();
  await loadPersistedSessions();
  webhookDispatcher.start();
  if (config.whatsappAutoConnect) await connectWhatsApp(config.defaultSession);

  const server = app.listen(config.port, () => {
    console.log(`API REST rodando na porta ${config.port}`);
  });
  const shutdown = () => server.close(async () => {
    await closeWhatsApp();
    webhookDispatcher.stop();
    await disconnectMongo();
    process.exit(0);
  });
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

start().catch(async (error) => {
  console.error("Falha ao iniciar API WhatsApp", { code: error.code, message: error.message });
  try {
    await closeWhatsApp();
    webhookDispatcher.stop();
    await disconnectMongo();
  } catch (cleanupError) {
    console.error("Falha ao limpar recursos após erro de inicialização", {
      code: cleanupError.code,
      name: cleanupError.name,
    });
  } finally {
    process.exitCode = 1;
  }
});
