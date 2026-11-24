const crypto = require("node:crypto");
const { Message } = require("../models");
const { isMongoReady } = require("../db");
const { eventDispatcher } = require("../events/dispatcher");
const { sendTextMessage } = require("../sendMessage");
const { AppError } = require("../errors");

const idempotencyLocks = new Map();

function assertIdempotencyMatch(existing, { to, text, quotedMessageId }) {
  const sameRequest = existing.remoteJid === to
    && existing.text === text
    && (existing.quotedMessage?.messageId || undefined) === quotedMessageId;
  if (!sameRequest) throw new AppError(409, "Idempotency-Key já foi usada com outro conteúdo", "IDEMPOTENCY_KEY_REUSED");
}

async function withIdempotencyLock(key, task) {
  const previous = idempotencyLocks.get(key) || Promise.resolve();
  const current = previous.then(task, task);
  const tail = current.catch(() => {});
  idempotencyLocks.set(key, tail);
  try {
    return await current;
  } finally {
    if (idempotencyLocks.get(key) === tail) idempotencyLocks.delete(key);
  }
}

async function findQuotedMessage({ sessionId, to, quotedMessageId }) {
  if (!quotedMessageId) return undefined;
  if (!isMongoReady()) throw new AppError(503, "MongoDB não está conectado", "MONGODB_NOT_CONNECTED");
  const quoted = await Message.findOne({ sessionId, whatsappMessageId: quotedMessageId }).select("sessionId remoteJid whatsappMessageId fromMe senderJid text type content").lean();
  if (!quoted) throw new AppError(404, "Mensagem citada não encontrada", "QUOTED_MESSAGE_NOT_FOUND");
  if (quoted.remoteJid !== to) throw new AppError(409, "Mensagem citada pertence a outro chat", "QUOTED_MESSAGE_CHAT_MISMATCH");
  if (!quoted.content && !quoted.text) throw new AppError(422, "A mensagem citada não possui conteúdo recuperável", "QUOTED_MESSAGE_CONTENT_UNAVAILABLE");
  return {
    key: { remoteJid: quoted.remoteJid, fromMe: quoted.fromMe, id: quoted.whatsappMessageId, participant: quoted.senderJid },
    message: quoted.content || { conversation: quoted.text },
  };
}

async function sendText({ sessionId, applicationId, to, text, idempotencyKey, quotedMessageId }) {
  const operation = async () => {
    if (isMongoReady() && idempotencyKey) {
      const existing = await Message.findOne({ sessionId, applicationId, idempotencyKey });
      if (existing) {
        assertIdempotencyMatch(existing, { to, text, quotedMessageId });
        return { message: existing, replayed: true };
      }
    }
    const operationId = idempotencyKey || crypto.randomUUID();
    const quoted = await findQuotedMessage({ sessionId, to, quotedMessageId });
    try {
      const result = await sendTextMessage(to, text, sessionId, quoted ? { quoted } : {});
      const whatsappMessageId = result?.key?.id;
      if (!whatsappMessageId) throw new AppError(502, "O WhatsApp não retornou o identificador da mensagem", "WHATSAPP_MESSAGE_ID_MISSING");
      const timestamp = new Date();
      const record = { sessionId, applicationId, direction: "outbound", remoteJid: to, chatId: to, whatsappMessageId, fromMe: true, type: "conversation", text, content: { conversation: text }, timestamp, status: "sent", idempotencyKey, quotedMessage: quotedMessageId ? { messageId: quotedMessageId, chatId: to } : undefined };
      const message = isMongoReady() ? await Message.findOneAndUpdate({ sessionId, applicationId, idempotencyKey: idempotencyKey || operationId }, record, { upsert: true, new: true, setDefaultsOnInsert: true }) : record;
      await eventDispatcher.publish({ type: "message.sent", sessionId, data: { sessionId, messageId: whatsappMessageId, chatId: to, remoteJid: to, fromMe: true, type: "conversation", text, timestamp: timestamp.toISOString(), quotedMessageId, applicationId } });
      return { message: message || record, replayed: false };
    } catch (error) {
      await eventDispatcher.publish({ type: "message.failed", sessionId, data: { operationId, remoteJid: to, applicationId, error: "send_failed" } });
      throw error;
    }
  };
  return idempotencyKey && isMongoReady()
    ? withIdempotencyLock(`${sessionId}:${applicationId}:${idempotencyKey}`, operation)
    : operation();
}

module.exports = { sendText };
