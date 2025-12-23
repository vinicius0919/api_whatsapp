const {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
} = require("@whiskeysockets/baileys");

const pino = require("pino");
const qrcode = require("qrcode-terminal");

const QRCode = require("qrcode");
let socket; // 🔒 socket global controlado
let lastQr = null; // 👈 guarda o último QR

async function connectWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState("auth");

  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: "silent" }),
  });

  sock.ev.on("connection.update", async ({ connection, qr }) => {
    if (qr) {
      console.log("📱 Novo QR Code gerado");

      // gera base64 (PNG)
      lastQr = await QRCode.toDataURL(qr);
    }

    if (connection === "open") {
      console.log("✅ WhatsApp conectado com sucesso");
      socket = sock;
      lastQr = null; // limpa QR após conexão
    }
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      console.log("📱 Escaneie o QR Code:");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "open") {
      console.log("✅ WhatsApp conectado com sucesso");
      socket = sock; // ✅ agora pode enviar mensagens
    }

    if (connection === "close") {
      const reason = lastDisconnect?.error?.output?.statusCode;

      if (reason !== DisconnectReason.loggedOut) {
        console.log("🔄 Reconectando WhatsApp...");
        connectWhatsApp();
      } else {
        console.log("❌ Sessão encerrada (logout)");
        socket = null;
      }
    }
  });
}

function getSocket() {
  if (!socket) {
    throw new Error("❌ WhatsApp ainda não está conectado");
  }
  return socket;
}
async function getGroups() {
  const sock = getSocket();

  const groups = await sock.groupFetchAllParticipating();

  return Object.values(groups).map((g) => ({
    id: g.id,
    subject: g.subject,
  }));
}

function getLastQr() {
  return lastQr;
}

module.exports = {
  connectWhatsApp,
  getSocket,
  getGroups,
  getLastQr,
};
