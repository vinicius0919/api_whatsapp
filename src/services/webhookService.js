const crypto = require("node:crypto");
const { WebhookSubscription } = require("../models");
const { isMongoReady } = require("../db");
const { encryptSecret, validateWebhookUrl } = require("../webhooks/security");
const { AppError } = require("../errors");

async function createSubscription({ applicationId, url, events, secret }) {
  if (!isMongoReady()) throw new AppError(503, "MongoDB não está conectado", "MONGODB_NOT_CONNECTED");
  if (!secret || typeof secret !== "string" || secret.length < 16) throw new AppError(400, "secret deve ter pelo menos 16 caracteres", "INVALID_WEBHOOK_SECRET");
  const safeUrl = await validateWebhookUrl(url, { allowLocalTest: true });
  const subscription = await WebhookSubscription.create({ id: `wh_${crypto.randomUUID()}`, applicationId, url: safeUrl, events: Array.isArray(events) ? events : ["*"], secretCiphertext: encryptSecret(secret) });
  return { id: subscription.id, applicationId, url: subscription.url, enabled: subscription.enabled, events: subscription.events, createdAt: subscription.createdAt, secret: "shown_once" };
}

async function listSubscriptions(applicationId) {
  if (!isMongoReady()) throw new AppError(503, "MongoDB não está conectado", "MONGODB_NOT_CONNECTED");
  return WebhookSubscription.find({ applicationId }).select("-secretCiphertext").lean();
}

async function updateSubscription(applicationId, id, { url, events, secret } = {}) {
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
  if (secret !== undefined) {
    if (typeof secret !== "string" || secret.length < 16) throw new AppError(400, "secret deve ter pelo menos 16 caracteres", "INVALID_WEBHOOK_SECRET");
    current.secretCiphertext = encryptSecret(secret);
  }
  await current.save();
  return { id: current.id, applicationId: current.applicationId, url: current.url, enabled: current.enabled, events: current.events, createdAt: current.createdAt, updatedAt: current.updatedAt, secret: secret === undefined ? undefined : "shown_once" };
}

async function deleteSubscription(applicationId, id) {
  if (!isMongoReady()) throw new AppError(503, "MongoDB não está conectado", "MONGODB_NOT_CONNECTED");
  const result = await WebhookSubscription.deleteOne({ applicationId, id });
  if (!result.deletedCount) throw new AppError(404, "Webhook não encontrado", "WEBHOOK_NOT_FOUND");
}

module.exports = { createSubscription, listSubscriptions, updateSubscription, deleteSubscription };
