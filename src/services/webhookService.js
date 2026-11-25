const crypto = require("node:crypto");
const { WebhookSubscription } = require("../models");
const { isMongoReady } = require("../db");
const { encryptSecret, validateWebhookUrl } = require("../webhooks/security");
const { AppError } = require("../errors");
const config = require("../config");

function normalizeChatIds(chatIds) {
  if (chatIds === undefined) return [];
  if (!Array.isArray(chatIds) || chatIds.some((chatId) => typeof chatId !== "string" || !/^\d+(?:@g\.us|@s\.whatsapp\.net)$/.test(chatId.trim()))) {
    throw new AppError(400, "chatIds deve conter JIDs WhatsApp válidos", "INVALID_WEBHOOK_CHAT_IDS");
  }
  return [...new Set(chatIds.map((chatId) => chatId.trim()))];
}

function validateChatScope(chatIds, events) {
  const normalized = normalizeChatIds(chatIds);
  const receivesMessages = events.includes("message.received") || events.includes("*");
  if (!receivesMessages || normalized.length === 0) return normalized;
  if (config.monitorMode !== "allowlist") {
    throw new AppError(403, "O escopo de grupos do webhook não está configurado", "WEBHOOK_CHAT_SCOPE_NOT_CONFIGURED");
  }
  const unauthorized = normalized.find((chatId) => !config.monitoredGroups.includes(chatId));
  if (unauthorized) {
    throw new AppError(403, "O grupo não está autorizado pelo Gateway", "WEBHOOK_CHAT_NOT_ALLOWED");
  }
  return normalized;
}

async function createSubscription({ applicationId, url, events, secret, chatIds }) {
  if (!isMongoReady()) throw new AppError(503, "MongoDB não está conectado", "MONGODB_NOT_CONNECTED");
  if (!secret || typeof secret !== "string" || secret.length < 16) throw new AppError(400, "secret deve ter pelo menos 16 caracteres", "INVALID_WEBHOOK_SECRET");
  const safeUrl = await validateWebhookUrl(url, { allowLocalTest: true });
  const normalizedEvents = Array.isArray(events) && events.length ? events : ["*"];
  const subscription = await WebhookSubscription.create({ id: `wh_${crypto.randomUUID()}`, applicationId, url: safeUrl, events: normalizedEvents, chatIds: validateChatScope(chatIds, normalizedEvents), secretCiphertext: encryptSecret(secret) });
  return { id: subscription.id, applicationId, url: subscription.url, enabled: subscription.enabled, events: subscription.events, chatIds: subscription.chatIds, createdAt: subscription.createdAt, secret: "shown_once" };
}

async function listSubscriptions(applicationId) {
  if (!isMongoReady()) throw new AppError(503, "MongoDB não está conectado", "MONGODB_NOT_CONNECTED");
  return WebhookSubscription.find({ applicationId }).select("-secretCiphertext").lean();
}

async function updateSubscription(applicationId, id, { url, events, chatIds, secret } = {}) {
  if (!isMongoReady()) throw new AppError(503, "MongoDB não está conectado", "MONGODB_NOT_CONNECTED");
  const current = await WebhookSubscription.findOne({ applicationId, id });
  if (!current) throw new AppError(404, "Webhook não encontrado", "WEBHOOK_NOT_FOUND");
  if (url !== undefined) current.url = await validateWebhookUrl(url, { allowLocalTest: true });
  if (events !== undefined) {
    if (!Array.isArray(events) || events.length === 0 || events.some((event) => typeof event !== "string" || !event.trim())) {
      throw new AppError(400, "events deve ser uma lista de eventos válida", "INVALID_WEBHOOK_EVENTS");
    }
    current.events = events;
  }
  if (chatIds !== undefined) current.chatIds = validateChatScope(chatIds, events !== undefined ? current.events : current.events);
  if (events !== undefined && chatIds === undefined) current.chatIds = validateChatScope(current.chatIds, current.events);
  if (secret !== undefined) {
    if (typeof secret !== "string" || secret.length < 16) throw new AppError(400, "secret deve ter pelo menos 16 caracteres", "INVALID_WEBHOOK_SECRET");
    current.secretCiphertext = encryptSecret(secret);
  }
  await current.save();
  return { id: current.id, applicationId: current.applicationId, url: current.url, enabled: current.enabled, events: current.events, chatIds: current.chatIds, createdAt: current.createdAt, updatedAt: current.updatedAt, secret: secret === undefined ? undefined : "shown_once" };
}

async function deleteSubscription(applicationId, id) {
  if (!isMongoReady()) throw new AppError(503, "MongoDB não está conectado", "MONGODB_NOT_CONNECTED");
  const result = await WebhookSubscription.deleteOne({ applicationId, id });
  if (!result.deletedCount) throw new AppError(404, "Webhook não encontrado", "WEBHOOK_NOT_FOUND");
}

module.exports = { createSubscription, listSubscriptions, updateSubscription, deleteSubscription, normalizeChatIds, validateChatScope };
