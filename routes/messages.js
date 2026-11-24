const express = require("express");
const router = express.Router();

const { sendText } = require("../src/services/messageService");
const { asyncRoute, validateMessageBody } = require("../src/middleware");
const rateLimit = require("express-rate-limit");
const config = require("../src/config");

router.post("/send", rateLimit({ windowMs: config.rateLimitWindowMs, limit: config.messageRateLimitMax, standardHeaders: "draft-7", legacyHeaders: false }), validateMessageBody, asyncRoute(async (req, res) => {
  const { number, message, quotedMessageId } = req.body;
  const jid = number.includes("@") ? number.trim() : `${number.trim()}@s.whatsapp.net`;
  const result = await sendText({ sessionId: req.auth.sessionId, applicationId: req.auth.applicationId, to: jid, text: message, quotedMessageId, idempotencyKey: req.get("idempotency-key") });
  return res.status(200).json({ success: true, sessionId: req.auth.sessionId, messageId: result.message.whatsappMessageId, chatId: result.message.chatId || jid, status: result.message.status, timestamp: result.message.timestamp, replayed: result.replayed });
}));


module.exports = router;
