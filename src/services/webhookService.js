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

async function deleteSubscription(applicationId, id) {
  if (!isMongoReady()) throw new AppError(503, "MongoDB não está conectado", "MONGODB_NOT_CONNECTED");
  const result = await WebhookSubscription.deleteOne({ applicationId, id });
  if (!result.deletedCount) throw new AppError(404, "Webhook não encontrado", "WEBHOOK_NOT_FOUND");
}

module.exports = { createSubscription, listSubscriptions, deleteSubscription };
