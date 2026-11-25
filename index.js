const app = require("./src/app");
const { connectWhatsApp, closeWhatsApp, loadPersistedSessions } = require("./src/whatsapp");
const config = require("./src/config");
const { connectMongo, disconnectMongo } = require("./src/db");
const { isMongoReady } = require("./src/db");
const { webhookDispatcher } = require("./src/webhooks/dispatcher");

async function start() {
  const server = app.listen(config.port, "0.0.0.0", () => {
    console.log(`API REST rodando na porta ${config.port}`);
  });
  server.on("error", (error) => {
    console.error("Falha ao abrir servidor HTTP", { code: error.code, message: error.message });
    process.exitCode = 1;
  });

  let initializationTimer;
  let sessionsLoaded = false;
  let dispatcherStarted = false;
  let initializing = false;

  const initialize = async () => {
    if (initializing) return;
    initializing = true;
    try {
      if (!isMongoReady()) await connectMongo();
      if (!sessionsLoaded) {
        await loadPersistedSessions();
        sessionsLoaded = true;
      }
      if (!dispatcherStarted) {
        webhookDispatcher.start();
        dispatcherStarted = true;
      }
      if (config.whatsappAutoConnect) {
        const status = require("./src/whatsapp").getSessionStatus(config.defaultSession);
        if (status.state !== "connected" && status.state !== "connecting" && status.state !== "reconnecting") {
          await connectWhatsApp(config.defaultSession);
        }
      }
      console.log("Dependências operacionais inicializadas", { mongo: true, whatsappAutoConnect: config.whatsappAutoConnect });
    } catch (error) {
      console.error("Dependências ainda não estão prontas; o servidor HTTP permanece disponível", { code: error.code, message: error.message });
      initializationTimer = setTimeout(() => initialize().catch(() => {}), 10000);
      initializationTimer.unref?.();
    } finally {
      initializing = false;
    }
  };

  initialize().catch(() => {});
  const shutdown = () => server.close(async () => {
    if (initializationTimer) clearTimeout(initializationTimer);
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
