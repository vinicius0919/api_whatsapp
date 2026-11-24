const test = require("node:test");
const assert = require("node:assert/strict");
const { Message } = require("../src/models");
const { safeErrorSummary } = require("../src/messages/debug");
const { isMessageIdentityDuplicateError } = require("../src/whatsapp");

test("schema preserva quotedMessage estruturado e aceita mensagem sem citação", () => {
  const quoted = new Message({
    sessionId: "default",
    applicationId: "app-a",
    direction: "inbound",
    remoteJid: "120363432779760997@g.us",
    whatsappMessageId: "inbound-quoted-1",
    fromMe: false,
    type: "extendedTextMessage",
    text: "Resposta",
    timestamp: new Date(),
    quotedMessage: {
      messageId: "original-1",
      chatId: "120363432779760997@g.us",
      participantJid: "5511999999999@s.whatsapp.net",
      participantLid: "123456789@lid",
      type: "conversation",
      text: "Original",
    },
  });
  assert.equal(quoted.validateSync(), undefined);
  assert.deepEqual(quoted.toObject().quotedMessage, {
    messageId: "original-1",
    chatId: "120363432779760997@g.us",
    participantJid: "5511999999999@s.whatsapp.net",
    participantLid: "123456789@lid",
    type: "conversation",
    text: "Original",
  });

  const withoutQuote = new Message({
    sessionId: "default",
    applicationId: "app-a",
    direction: "inbound",
    remoteJid: "5511999999999@s.whatsapp.net",
    whatsappMessageId: "inbound-no-quote-1",
    fromMe: false,
    type: "conversation",
    text: "Sem citação",
    timestamp: new Date(),
  });
  assert.equal(withoutQuote.validateSync(), undefined);
  assert.equal(withoutQuote.quotedMessage, undefined);
});

test("schema declara índice parcial de idempotência e índice de mensagem WhatsApp", () => {
  const indexes = Message.schema.indexes();
  assert.ok(indexes.some(([keys, options]) => keys.sessionId === 1 && keys.whatsappMessageId === 1 && options.unique === true));
  assert.ok(indexes.some(([keys, options]) => keys.sessionId === 1 && keys.applicationId === 1 && keys.idempotencyKey === 1
    && options.unique === true
    && options.partialFilterExpression.idempotencyKey.$type === "string"));
  assert.equal(indexes.some(([, options]) => options.sparse === true && options.unique === true && options.partialFilterExpression), false);
});

test("sanitiza erros do Mongoose sem registrar mensagens ou valores brutos", () => {
  const error = new Error("Message validation failed: quotedMessage: Cast to string failed for value Object");
  error.name = "ValidationError";
  error.errors = { quotedMessage: { name: "CastError", path: "quotedMessage", value: { text: "segredo" } } };
  const summary = safeErrorSummary(error);
  assert.deepEqual(summary, { errorName: "ValidationError", code: undefined, path: "quotedMessage", reason: "CAST_ERROR", index: undefined });
  assert.doesNotMatch(JSON.stringify(summary), /segredo|quotedMessage.*text/);
});

test("distingue E11000 do identificador real de outras unicidades", () => {
  assert.equal(isMessageIdentityDuplicateError({ code: 11000, keyPattern: { sessionId: 1, whatsappMessageId: 1 } }), true);
  assert.equal(isMessageIdentityDuplicateError({ code: 11000, keyPattern: { sessionId: 1, applicationId: 1, idempotencyKey: 1 } }), false);
  assert.equal(isMessageIdentityDuplicateError({ code: 11000, index: "sessionId_1_whatsappMessageId_1" }), true);
  assert.equal(isMessageIdentityDuplicateError({ code: 11000, keyPattern: { sessionId: 1 } }), false);
});
