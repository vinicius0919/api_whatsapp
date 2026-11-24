const express = require("express");
const router = express.Router();
const { getGroups } = require("../src/whatsapp");
const { sendText } = require("../src/services/messageService");
const { asyncRoute, validateMessageBody } = require("../src/middleware");
const rateLimit = require("express-rate-limit");
const config = require("../src/config");
function normalizeJid(input) {
  if (!input || typeof input !== "string") {
    throw new Error("JID inválido: valor ausente");
  }

  const jid = input.trim();

  // Grupo
  if (/^\d+@g\.us$/.test(jid)) {
    return jid;
  }

  // Contato
  if (/^\d+$/.test(jid)) {
    return `${jid}@s.whatsapp.net`;
  }

  // Contato já formatado
  if (/^\d+@s\.whatsapp\.net$/.test(jid)) {
    return jid;
  }

  throw new Error(`JID inválido: ${jid}`);
}

router.get("/", asyncRoute(async (req, res) => res.json(await getGroups(req.auth.sessionId))));

router.post("/send", rateLimit({ windowMs: config.rateLimitWindowMs, limit: config.messageRateLimitMax, standardHeaders: "draft-7", legacyHeaders: false }), validateMessageBody, asyncRoute(async (req, res) => {
  const { number, message, quotedMessageId } = req.body;
  const jid = normalizeJid(number);
  const result = await sendText({ sessionId: req.auth.sessionId, applicationId: req.auth.applicationId, to: jid, text: message, quotedMessageId, idempotencyKey: req.get("idempotency-key") });
  return res.status(200).json({ success: true, sessionId: req.auth.sessionId, messageId: result.message.whatsappMessageId, chatId: result.message.chatId || jid, status: result.message.status, timestamp: result.message.timestamp, replayed: result.replayed });
}));

module.exports = router;
module.exports.normalizeJid = normalizeJid;
