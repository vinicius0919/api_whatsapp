const { getSocket } = require("./whatsapp");

async function sendTextMessage(jid, text, sessionId, options = {}) {
  const sock = getSocket(sessionId);

  const result = await sock.sendMessage(jid, { text }, options);

  return result;
}

module.exports = { sendTextMessage };
