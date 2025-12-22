const axios = require("axios");
require("dotenv").config();

const WHAPI_URL = "https://gate.whapi.cloud/messages/text";

async function sendMessage(to, message) {
  const payload = {
    to,
    body: message,
  };

  const headers = {
    Authorization: `Bearer ${process.env.WHAPI_TOKEN}`,
    "Content-Type": "application/json",
  };

  const response = await axios.post(WHAPI_URL, payload, { headers });
  return response.data;
}
const { getSocket } = require("./whatsapp");


async function sendTextMessage(jid, text) {
  const sock = getSocket();

  await sock.sendMessage(jid, { text });

  console.log(`📤 Mensagem enviada para ${jid}`);
}

module.exports = { sendMessage, sendTextMessage };
