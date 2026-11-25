const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const testUri = process.env.TEST_MONGODB_URI;
if (!testUri) {
  console.error("TEST_MONGODB_URI é obrigatória; nenhum fluxo de webhook será executado.");
  process.exitCode = 2;
} else {
  let parsed;
  try { parsed = new URL(testUri); } catch { parsed = null; }
  if (!parsed || !/(^|_)test($|[._-])|test/i.test(parsed.pathname.split("/").pop() || "")) {
    console.error("Abortado: TEST_MONGODB_URI deve apontar para um banco explicitamente de teste.");
    process.exitCode = 2;
  } else {
    process.env.MONGODB_URI = testUri;
    process.env.WEBHOOK_ALLOW_LOCAL_TEST = "true";
    process.env.WEBHOOK_TEST_SECRET = process.env.WEBHOOK_TEST_SECRET || "webhook-test-secret-123456";
    run().catch((error) => {
      console.error("Falha no fluxo de homologação", { name: error.name, code: error.code, message: String(error.message || "falha").slice(0, 200) });
      process.exitCode = 1;
    });
  }
}

async function run() {
  const { connectMongo, disconnectMongo } = require("../src/db");
  const { createDeclaredIndexes } = require("../src/indexes");
  const { Application, Session, WebhookSubscription, WebhookDelivery, Event } = require("../src/models");
  const { createSubscription } = require("../src/services/webhookService");
  const { WebhookDispatcher } = require("../src/webhooks/dispatcher");
  const { eventDispatcher } = require("../src/events/dispatcher");
  const { createWebhookTestServer } = require("./webhook-test-server");

  const suffix = crypto.randomUUID().replaceAll("-", "");
  const applicationId = `webhook-test-app-${suffix}`;
  const sessionId = `webhook-test-session-${suffix}`;
  const eventId = `webhook-test-event-${suffix}`;
  const receiver = createWebhookTestServer();
  let subscription;
  const dispatcher = new WebhookDispatcher();

  try {
    await connectMongo();
    await createDeclaredIndexes();
    await receiver.listen();
    await Application.create({ id: applicationId, name: "Webhook test", allowedSessionIds: [sessionId] });
    await Session.create({ id: sessionId, name: "Webhook test", ownerApplicationId: applicationId, authStoragePath: `/tmp/${sessionId}` });
    subscription = await createSubscription({ applicationId, url: `http://127.0.0.1:${process.env.WEBHOOK_TEST_RECEIVER_PORT || 3104}/webhook`, events: ["message.received"], secret: process.env.WEBHOOK_TEST_SECRET });
    dispatcher.start();
    const event = await eventDispatcher.publish({ eventId, type: "message.received", sessionId, data: { sessionId, messageId: "message-test-1", chatId: "120363432779760997@g.us", senderJid: "5511999999999@s.whatsapp.net", isGroup: true, fromMe: false, forwarded: false, text: "evento de teste", quotedMessage: { messageId: "pedido-1", chatId: "120363432779760997@g.us", participantJid: "5511888888888@s.whatsapp.net", text: "pedido" } } });
    await waitFor(async () => receiver.received.some((item) => item.eventId === eventId), 5000, async () => {
      const pending = await WebhookDelivery.findOne({ eventId, subscriptionId: subscription.id }).lean();
      if (pending) console.error("Entrega ainda não recebida", { status: pending.status, attempts: pending.attempts, lastError: pending.lastError });
    });
    const delivery = await WebhookDelivery.findOne({ eventId, subscriptionId: subscription.id }).lean();
    assert.equal(delivery.status, "delivered");
    assert.equal(receiver.received.length, 1);
    assert.equal(receiver.received[0].payload.data.quotedMessage.messageId, "pedido-1");
    await dispatcher.enqueue(event);
    assert.equal(receiver.received.length, 1, "entrega já concluída deve ser deduplicada");
    const duplicateResponse = await postInvalidSignature(receiver.server.address().port, event);
    assert.equal(duplicateResponse.status, 401);
    console.log(JSON.stringify({ ok: true, receiver: "validated", delivery: delivery.status, deduplication: "validated", invalidSignature: "validated", api: await checkApiHealth() }));
  } finally {
    dispatcher.stop();
    await WebhookSubscription.deleteMany({ id: subscription?.id }).catch(() => {});
    await WebhookDelivery.deleteMany({ eventId }).catch(() => {});
    await Event.deleteMany({ eventId }).catch(() => {});
    await Session.deleteMany({ id: sessionId }).catch(() => {});
    await Application.deleteMany({ id: applicationId }).catch(() => {});
    await receiver.close().catch(() => {});
    await disconnectMongo();
  }
}

async function waitFor(predicate, timeout = 5000, onTimeout) {
  const start = Date.now();
  while (!(await predicate())) {
    if (Date.now() - start > timeout) {
      await onTimeout?.();
      throw new Error("Timeout aguardando entrega do webhook");
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function postInvalidSignature(port, event) {
  const body = JSON.stringify(event);
  return fetch(`http://127.0.0.1:${port}/webhook`, { method: "POST", headers: { "content-type": "application/json", "x-webhook-timestamp": new Date().toISOString(), "x-webhook-event-id": event.eventId, "x-webhook-signature": "sha256=invalid" }, body });
}

async function checkApiHealth() {
  const url = process.env.WEBHOOK_TEST_API_URL || "http://127.0.0.1:3003/health";
  try { const response = await fetch(url, { signal: AbortSignal.timeout(1500) }); return `HTTP_${response.status}`; } catch { return "UNAVAILABLE"; }
}
