const express = require("express");
const { asyncRoute, validateMessageBody } = require("../../src/middleware");
const { requireSessionAccess } = require("../../src/auth");
const { normalizeJid } = require("../groups");
const { sendText } = require("../../src/services/messageService");
const { Message } = require("../../src/models");
const { isMongoReady } = require("../../src/db");
const { AppError } = require("../../src/errors");

const router = express.Router();

function ensureDb() {
  if (!isMongoReady()) throw new AppError(503, "MongoDB não está conectado", "MONGODB_NOT_CONNECTED");
}

router.post("/text", validateMessageBody, asyncRoute(async (req, res) => {
  const { sessionId, to, number, message, text, quotedMessageId } = req.body || {};
  const targetSession = sessionId || req.auth.sessionId;
  requireSessionAccess(req, targetSession);
  const target = normalizeJid(to || number);
  const content = text || message;
  const result = await sendText({ sessionId: targetSession, applicationId: req.auth.applicationId, to: target, text: content, quotedMessageId, idempotencyKey: req.get("idempotency-key") });
  res.status(result.replayed ? 200 : 201).json({ sessionId: targetSession, messageId: result.message.whatsappMessageId, id: result.message.whatsappMessageId, chatId: result.message.chatId || target, status: result.message.status, timestamp: result.message.timestamp, replayed: result.replayed });
}));

router.get("/sessions/:id/messages", asyncRoute(async (req, res) => {
  ensureDb();
  requireSessionAccess(req, req.params.id);
  const limit = Math.min(Number(req.query.limit) || 50, 100);
  res.json(await Message.find({ sessionId: req.params.id }).sort({ timestamp: -1 }).limit(limit).lean());
}));

router.get("/:id", asyncRoute(async (req, res) => {
  ensureDb();
  const message = await Message.findOne({ whatsappMessageId: req.params.id }).lean();
  if (!message) throw new AppError(404, "Mensagem não encontrada", "MESSAGE_NOT_FOUND");
  requireSessionAccess(req, message.sessionId);
  res.json(message);
}));

module.exports = router;
