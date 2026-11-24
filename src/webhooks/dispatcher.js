const { Event, Session, WebhookSubscription, WebhookDelivery } = require("../models");
const { isMongoReady } = require("../db");
const { decryptSecret, signPayload, validateWebhookUrl } = require("./security");
const { eventDispatcher } = require("../events/dispatcher");
const config = require("../config");

class WebhookDispatcher {
  constructor({ fetchImpl = fetch, validateUrl = (url) => validateWebhookUrl(url, { allowLocalTest: config.webhookAllowLocalTest }) } = {}) {
    this.unsubscribe = null;
    this.timer = null;
    this.fetchImpl = fetchImpl;
    this.validateUrl = validateUrl;
  }

  start() {
    if (this.unsubscribe) return;
    this.unsubscribe = eventDispatcher.on((event) => this.enqueue(event).catch((error) => console.error("Falha ao enfileirar webhook", error.message)));
    this.timer = setInterval(() => this.retryPending().catch((error) => console.error("Falha ao recuperar webhooks", error.message)), 5000);
    this.timer.unref?.();
  }

  stop() {
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async enqueue(event) {
    if (!isMongoReady()) return;
    const session = await Session.findOne({ id: event.sessionId }).lean();
    if (!session) return;
    const applicationId = session.id === config.defaultSession && session.ownerApplicationId === "system"
      ? config.defaultApplicationId
      : session.ownerApplicationId;
    const subscriptions = await WebhookSubscription.find({ applicationId, enabled: true, events: { $in: [event.type, "*"] } }).lean();
    await Promise.all(subscriptions.map(async (subscription) => {
      await WebhookDelivery.updateOne({ eventId: event.eventId, subscriptionId: subscription.id }, { $setOnInsert: { eventId: event.eventId, subscriptionId: subscription.id, status: "pending", attempts: 0, nextAttemptAt: new Date() } }, { upsert: true });
      await this.deliver({ event, subscription });
    }));
  }

  async retryPending() {
    if (!isMongoReady()) return;
    const deliveries = await WebhookDelivery.find({ status: "pending", nextAttemptAt: { $lte: new Date() } }).limit(25).lean();
    for (const delivery of deliveries) {
      const subscription = await WebhookSubscription.findOne({ id: delivery.subscriptionId, enabled: true }).lean();
      const event = await Event.findOne({ eventId: delivery.eventId }).lean();
      if (subscription && event) await this.deliver({ event: event.payload, subscription, delivery });
    }
  }

  async deliver({ event, subscription, delivery }) {
    const record = delivery || await WebhookDelivery.findOne({ eventId: event.eventId, subscriptionId: subscription.id }).lean();
    if (record?.status === "delivered") return;
    const attempts = (record?.attempts || 0) + 1;
    const body = JSON.stringify(event);
    const timestamp = new Date().toISOString();
    try {
      await this.validateUrl(subscription.url);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const response = await this.fetchImpl(subscription.url, { method: "POST", redirect: "error", signal: controller.signal, headers: { "content-type": "application/json", "x-webhook-timestamp": timestamp, "x-webhook-event-id": event.eventId, "x-webhook-signature": `sha256=${signPayload(decryptSecret(subscription.secretCiphertext), body, timestamp, event.eventId)}` }, body });
      clearTimeout(timeout);
      if (!response.ok) throw new Error(`HTTP_${response.status}`);
      await WebhookDelivery.updateOne({ eventId: event.eventId, subscriptionId: subscription.id }, { $set: { status: "delivered", attempts, deliveredAt: new Date(), lastError: null } }, { upsert: true });
    } catch (error) {
      const maxAttempts = 8;
      await WebhookDelivery.updateOne({ eventId: event.eventId, subscriptionId: subscription.id }, { $set: { status: attempts >= maxAttempts ? "failed" : "pending", attempts, nextAttemptAt: new Date(Date.now() + Math.min(300000, 1000 * (2 ** Math.min(attempts, 8))) + Math.floor(Math.random() * 1000)), lastError: String(error.message || "delivery_failed").slice(0, 500) } }, { upsert: true });
    }
  }
}

module.exports = { WebhookDispatcher, webhookDispatcher: new WebhookDispatcher() };
