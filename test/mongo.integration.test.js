const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function isUnsafeTestDatabase(uri) {
  if (!uri) return true;
  if (uri === process.env.MONGODB_URI) return true;
  try {
    const parsed = new URL(uri);
    const databaseName = parsed.pathname.replace(/^\//, "");
    return databaseName === "api_whatsapp"
      || !/(^|[_-])test([_-]|$)/i.test(databaseName);
  } catch {
    return true;
  }
}

if (!process.env.TEST_MONGODB_URI) {
  test("integração MongoDB requer TEST_MONGODB_URI", { skip: "MongoDB de teste não configurado" }, () => {});
} else if (isUnsafeTestDatabase(process.env.TEST_MONGODB_URI)) {
  test("integração MongoDB exige banco isolado", { skip: "TEST_MONGODB_URI aponta para o banco principal/local api_whatsapp" }, () => {});
} else {
  process.env.MONGODB_URI = process.env.TEST_MONGODB_URI;
  process.env.WEBHOOK_ENCRYPTION_KEY = "integration-test-only-key";
  process.env.WHATSAPP_AUTH_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "api-whatsapp-integration-auth-"));
  process.env.WHATSAPP_SESSION_AUTH_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "api-whatsapp-integration-sessions-"));
  process.env.WHATSAPP_SESSION_LOCK_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "api-whatsapp-integration-locks-"));

  const { connectMongo, disconnectMongo, mongoose } = require("../src/db");
  const { Application, Session, Message, Event, WebhookSubscription, WebhookDelivery } = require("../src/models");
  const whatsapp = require("../src/whatsapp");
  const { WebhookDispatcher } = require("../src/webhooks/dispatcher");
  const { encryptSecret, signPayload } = require("../src/webhooks/security");
  const { applyMigration } = require("../scripts/migrate-message-indexes");
  const { createDeclaredIndexes, inspectIndexes } = require("../src/indexes");
  const models = [Application, Session, Message, Event, WebhookSubscription, WebhookDelivery];

  test.before(async () => {
    await connectMongo();
    await Promise.all(models.map((model) => model.deleteMany({})));
    await applyMigration();
    const report = await createDeclaredIndexes();
    assert.equal(report.missing.length, 0);
    assert.equal(report.conflicts.length, 0);
  });

  test.beforeEach(async () => {
    await Promise.all(models.map((model) => model.deleteMany({})));
    whatsapp.resetSessionsForTests();
  });

  test.after(async () => {
    await Promise.all(models.map((model) => model.deleteMany({})));
    whatsapp.resetSessionsForTests();
    await disconnectMongo();
  });

  test("migra índice sparse legado para parcial e permite reexecução", async () => {
    const target = "sessionId_1_applicationId_1_idempotencyKey_1_partial";
    const legacy = "sessionId_1_applicationId_1_idempotencyKey_1";
    await Message.collection.dropIndex(target);
    await Message.collection.createIndex({ sessionId: 1, applicationId: 1, idempotencyKey: 1 }, { name: legacy, unique: true, sparse: true });
    await applyMigration();
    await applyMigration();
    const indexes = await Message.collection.listIndexes().toArray();
    assert.equal(indexes.some((index) => index.name === target && index.partialFilterExpression?.idempotencyKey?.$type === "string"), true);
    assert.equal(indexes.some((index) => index.name === legacy), false);
  });

  test("provisiona todos os índices declarados de forma idempotente", async () => {
    const first = await createDeclaredIndexes();
    const second = await createDeclaredIndexes();
    assert.equal(first.missing.length, 0);
    assert.equal(first.conflicts.length, 0);
    assert.equal(second.missing.length, 0);
    assert.equal(second.conflicts.length, 0);
    const report = await inspectIndexes();
    assert.equal(report.missing.length, 0);
    assert.equal(report.conflicts.length, 0);
  });

  test("persiste sessões, deduplica mensagens/eventos e recupera estado", async () => {
    await Application.create({ id: "app-a", name: "Aplicação A", allowedSessionIds: ["session-a"] });
    await whatsapp.sessionManager.createSession({ id: "session-a", name: "Sessão A", ownerApplicationId: "app-a" });
    whatsapp.resetSessionsForTests();
    await whatsapp.loadPersistedSessions();
    assert.equal(whatsapp.getSessionStatus("session-a").state, "created");

    const message = { sessionId: "session-a", applicationId: "app-a", direction: "inbound", remoteJid: "5511999999999@s.whatsapp.net", whatsappMessageId: "wam-1", fromMe: false, type: "conversation", text: "Olá", timestamp: new Date() };
    await Message.create(message);
    await assert.rejects(Message.create(message), (error) => error.code === 11000);
    const event = { eventId: "evt-1", sessionId: "session-a", type: "message.received", payload: { eventId: "evt-1", type: "message.received" } };
    await Event.create(event);
    await assert.rejects(Event.create(event), (error) => error.code === 11000);
    assert.equal(await Message.countDocuments({ sessionId: "session-a" }), 1);
    assert.equal(await Event.countDocuments({ sessionId: "session-a" }), 1);
  });

  test("permite várias mensagens inbound sem idempotencyKey e persiste citação estruturada", async () => {
    await Message.create([
      { sessionId: "session-a", applicationId: "app-a", direction: "inbound", remoteJid: "120363432779760997@g.us", whatsappMessageId: "inbound-a", fromMe: false, type: "conversation", text: "A", timestamp: new Date() },
      { sessionId: "session-a", applicationId: "app-a", direction: "inbound", remoteJid: "120363432779760997@g.us", whatsappMessageId: "inbound-b", fromMe: false, type: "extendedTextMessage", text: "B", timestamp: new Date(), quotedMessage: { messageId: "inbound-a", chatId: "120363432779760997@g.us", participantJid: "5511999999999@s.whatsapp.net", participantLid: "123@lid", type: "conversation", text: "A" } },
      { sessionId: "session-a", applicationId: "app-a", direction: "inbound", remoteJid: "120363432779760997@g.us", whatsappMessageId: "inbound-c", fromMe: false, type: "conversation", text: "C", timestamp: new Date() },
    ]);
    assert.equal(await Message.countDocuments({ sessionId: "session-a", direction: "inbound" }), 3);
    const persisted = await Message.findOne({ whatsappMessageId: "inbound-b" }).lean();
    assert.equal(persisted.quotedMessage.participantJid, "5511999999999@s.whatsapp.net");
    assert.equal(persisted.quotedMessage.participantLid, "123@lid");
  });

  test("envia resposta citada somente no mesmo chat", async () => {
    const { sendText } = require("../src/services/messageService");
    const sent = [];
    await Message.create({ sessionId: "session-a", applicationId: "app-a", direction: "inbound", remoteJid: "5511999999999@s.whatsapp.net", whatsappMessageId: "wam-1", fromMe: false, type: "conversation", text: "Olá", timestamp: new Date() });
    whatsapp.setSessionForTests("session-a", { state: "connected" });
    whatsapp.setSessionForTests("session-a", {
      state: "connected",
      socket: { async sendMessage(jid, content, options) { sent.push({ jid, content, options }); return { key: { id: "quoted-reply-1" } }; } },
    });
    const result = await sendText({ sessionId: "session-a", applicationId: "app-a", to: "5511999999999@s.whatsapp.net", text: "Resposta", quotedMessageId: "wam-1" });
    assert.equal(result.message.whatsappMessageId, "quoted-reply-1");
    assert.equal(sent[0].options.quoted.key.id, "wam-1");
    assert.equal(sent[0].options.quoted.message.conversation, "Olá");
    await assert.rejects(() => sendText({ sessionId: "session-a", applicationId: "app-a", to: "120363@g.us", text: "Inválida", quotedMessageId: "wam-1" }), (error) => error.code === "QUOTED_MESSAGE_CHAT_MISMATCH");
  });

  test("serializa requisições concorrentes e rejeita reutilização incompatível da chave", async () => {
    const { sendText } = require("../src/services/messageService");
    let sends = 0;
    whatsapp.setSessionForTests("session-a", {
      state: "connected",
      socket: { async sendMessage() { sends += 1; await new Promise((resolve) => setTimeout(resolve, 20)); return { key: { id: "idempotent-reply-1" } }; } },
    });
    const requests = [1, 2].map(() => sendText({ sessionId: "session-a", applicationId: "app-a", to: "5511999999999@s.whatsapp.net", text: "Única", idempotencyKey: "same-key" }));
    const results = await Promise.all(requests);
    assert.equal(sends, 1);
    assert.equal(results.filter((result) => result.replayed).length, 1);
    assert.equal(await Message.countDocuments({ idempotencyKey: "same-key" }), 1);
    await assert.rejects(
      () => sendText({ sessionId: "session-a", applicationId: "app-a", to: "5511999999999@s.whatsapp.net", text: "Outro conteúdo", idempotencyKey: "same-key" }),
      (error) => error.code === "IDEMPOTENCY_KEY_REUSED"
    );
  });

  test("persiste retry de webhook, assina o corpo e recupera entrega pendente", async () => {
    await Application.create({ id: "app-a", name: "Aplicação A", allowedSessionIds: ["session-a"] });
    await Session.create({ id: "session-a", name: "Sessão A", ownerApplicationId: "app-a", authStoragePath: path.join(process.env.WHATSAPP_SESSION_AUTH_ROOT, "session-a") });
    const subscription = await WebhookSubscription.create({ id: "sub-a", applicationId: "app-a", url: "https://webhook.example.test/events", events: ["message.received"], secretCiphertext: encryptSecret("webhook-secret") });
    await Event.create({ eventId: "evt-webhook-1", sessionId: "session-a", type: "message.received", payload: { eventId: "evt-webhook-1", type: "message.received", sessionId: "session-a", data: { text: "Olá" } } });
    let calls = 0;
    let lastOptions;
    const fetchImpl = async (_url, options) => {
      calls += 1;
      lastOptions = options;
      return calls === 1 ? { ok: false, status: 503 } : { ok: true, status: 200 };
    };
    const dispatcher = new WebhookDispatcher({ fetchImpl, validateUrl: async () => {} });
    await dispatcher.enqueue({ eventId: "evt-webhook-1", type: "message.received", sessionId: "session-a", timestamp: new Date().toISOString(), data: { text: "Olá" } });
    let delivery = await WebhookDelivery.findOne({ eventId: "evt-webhook-1", subscriptionId: subscription.id }).lean();
    assert.equal(delivery.status, "pending");
    assert.equal(delivery.attempts, 1);
    await WebhookDelivery.updateOne({ _id: delivery._id }, { $set: { nextAttemptAt: new Date(0) } });
    await dispatcher.retryPending();
    delivery = await WebhookDelivery.findOne({ eventId: "evt-webhook-1", subscriptionId: subscription.id }).lean();
    assert.equal(delivery.status, "delivered");
    assert.equal(delivery.attempts, 2);
    assert.equal(lastOptions.headers["x-webhook-event-id"], "evt-webhook-1");
    assert.equal(lastOptions.headers["x-webhook-signature"], `sha256=${signPayload("webhook-secret", lastOptions.body, lastOptions.headers["x-webhook-timestamp"], "evt-webhook-1")}`);

    await dispatcher.enqueue({ eventId: "evt-webhook-1", type: "message.received", sessionId: "session-a", timestamp: new Date().toISOString(), data: { text: "duplicado" } });
    assert.equal(await WebhookDelivery.countDocuments({ eventId: "evt-webhook-1", subscriptionId: subscription.id }), 1);

    await Event.create({ eventId: "evt-webhook-2", sessionId: "session-a", type: "message.received", payload: { eventId: "evt-webhook-2", type: "message.received", sessionId: "session-a" } });
    calls = 0;
    await dispatcher.enqueue({ eventId: "evt-webhook-2", type: "message.received", sessionId: "session-a", timestamp: new Date().toISOString(), data: {} });
    const restarted = new WebhookDispatcher({ fetchImpl: async () => ({ ok: true, status: 200 }), validateUrl: async () => {} });
    await WebhookDelivery.updateOne({ eventId: "evt-webhook-2", subscriptionId: subscription.id }, { $set: { nextAttemptAt: new Date(0) } });
    await restarted.retryPending();
    assert.equal((await WebhookDelivery.findOne({ eventId: "evt-webhook-2", subscriptionId: subscription.id })).status, "delivered");
  });

  test("mantém isolamento por aplicação e impede entrega para subscription desativada", async () => {
    await Application.create({ id: "app-a", name: "Aplicação A", allowedSessionIds: ["session-a"] });
    await Session.create({ id: "session-a", name: "Sessão A", ownerApplicationId: "app-a", authStoragePath: path.join(process.env.WHATSAPP_SESSION_AUTH_ROOT, "session-a") });
    await Application.create({ id: "app-b", name: "Aplicação B", allowedSessionIds: ["session-b"] });
    await Session.create({ id: "session-b", name: "Sessão B", ownerApplicationId: "app-b", authStoragePath: path.join(process.env.WHATSAPP_SESSION_AUTH_ROOT, "session-b") });
    const subB = await WebhookSubscription.create({ id: "sub-b", applicationId: "app-b", url: "https://webhook.example.test/b", events: ["message.received"], enabled: false, secretCiphertext: encryptSecret("b-secret") });
    const dispatcher = new WebhookDispatcher({ fetchImpl: async () => ({ ok: true, status: 200 }), validateUrl: async () => {} });
    await dispatcher.enqueue({ eventId: "evt-isolation", type: "message.received", sessionId: "session-a", timestamp: new Date().toISOString(), data: {} });
    assert.equal(await WebhookDelivery.countDocuments({ subscriptionId: subB.id }), 0);
  });

  test("encaminha a sessão default legada system para a aplicação padrão", async () => {
    await Session.create({ id: "default", name: "Default", ownerApplicationId: "system", authStoragePath: path.join(process.env.WHATSAPP_AUTH_DIR, "default") });
    const subscription = await WebhookSubscription.create({ id: "sub-default", applicationId: "default", url: "https://webhook.example.test/default", events: ["message.received"], secretCiphertext: encryptSecret("default-secret") });
    const dispatcher = new WebhookDispatcher({ fetchImpl: async () => ({ ok: true, status: 200 }), validateUrl: async () => {} });
    await dispatcher.enqueue({ eventId: "evt-default-legacy", type: "message.received", sessionId: "default", timestamp: new Date().toISOString(), data: { messageId: "m-default" } });
    const delivery = await WebhookDelivery.findOne({ eventId: "evt-default-legacy", subscriptionId: subscription.id }).lean();
    assert.equal(delivery.status, "delivered");
    assert.equal(delivery.attempts, 1);
  });

  test("encaminha sessão compartilhada somente para aplicações autorizadas e chats inscritos", async () => {
    const groupId = "120363432779760997@g.us";
    await Application.create([
      { id: "req-services", name: "Req Services", role: "application", allowedSessionIds: ["default"], permissions: ["webhooks:manage"] },
      { id: "other-app", name: "Other", role: "application", allowedSessionIds: ["default"], permissions: ["webhooks:manage"] },
    ]);
    await Session.create({ id: "default", name: "Default", ownerApplicationId: "default", authStoragePath: path.join(process.env.WHATSAPP_AUTH_DIR, "default") });
    const reqSubscription = await WebhookSubscription.create({ id: "sub-req", applicationId: "req-services", url: "https://webhook.example.test/req", events: ["message.received"], chatIds: [groupId], secretCiphertext: encryptSecret("req-secret") });
    const otherSubscription = await WebhookSubscription.create({ id: "sub-other", applicationId: "other-app", url: "https://webhook.example.test/other", events: ["message.received"], chatIds: ["999999@g.us"], secretCiphertext: encryptSecret("other-secret") });
    const unscopedSubscription = await WebhookSubscription.create({ id: "sub-unscoped", applicationId: "other-app", url: "https://webhook.example.test/unscoped", events: ["message.received"], secretCiphertext: encryptSecret("unscoped-secret") });
    let deliveredBody;
    const dispatcher = new WebhookDispatcher({ fetchImpl: async (_url, options) => { deliveredBody = JSON.parse(options.body); return { ok: true, status: 200 }; }, validateUrl: async () => {} });

    await dispatcher.enqueue({ eventId: "evt-shared-group", type: "message.received", sessionId: "default", timestamp: new Date().toISOString(), data: { chatId: groupId } });
    assert.equal((await WebhookDelivery.findOne({ eventId: "evt-shared-group", subscriptionId: reqSubscription.id })).status, "delivered");
    assert.equal(await WebhookDelivery.countDocuments({ eventId: "evt-shared-group", subscriptionId: otherSubscription.id }), 0);
    assert.equal(await WebhookDelivery.countDocuments({ eventId: "evt-shared-group", subscriptionId: unscopedSubscription.id }), 0);
    assert.equal(deliveredBody.applicationId, "req-services");

    await dispatcher.enqueue({ eventId: "evt-shared-other-chat", type: "message.received", sessionId: "default", timestamp: new Date().toISOString(), data: { chatId: "999999@g.us" } });
    assert.equal(await WebhookDelivery.countDocuments({ eventId: "evt-shared-other-chat", subscriptionId: reqSubscription.id }), 0);
    assert.equal((await WebhookDelivery.findOne({ eventId: "evt-shared-other-chat", subscriptionId: otherSubscription.id })).status, "delivered");
  });
}
