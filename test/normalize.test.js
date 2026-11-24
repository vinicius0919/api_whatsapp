const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeMessage } = require("../src/messages/normalize");

test("normaliza texto privado com identidade e timestamp", () => {
  const result = normalizeMessage({
    key: { id: "msg-private", remoteJid: "5511999999999@s.whatsapp.net", fromMe: false },
    pushName: "Contato Teste",
    messageTimestamp: 1700000000,
    message: { conversation: "Olá" },
  });

  assert.deepEqual({
    messageId: result.messageId,
    chatId: result.chatId,
    senderJid: result.senderJid,
    phoneNumber: result.phoneNumber,
    displayName: result.displayName,
    isGroup: result.isGroup,
    fromMe: result.fromMe,
    type: result.type,
    text: result.text,
  }, {
    messageId: "msg-private",
    chatId: "5511999999999@s.whatsapp.net",
    senderJid: "5511999999999@s.whatsapp.net",
    phoneNumber: "5511999999999",
    displayName: "Contato Teste",
    isGroup: false,
    fromMe: false,
    type: "conversation",
    text: "Olá",
  });
});

test("diferencia grupo, participante e LID sem tratar LID como telefone", () => {
  const result = normalizeMessage({
    key: { id: "msg-group", remoteJid: "120363@g.us", participant: "12345@lid", fromMe: false },
    message: { extendedTextMessage: { text: "Resposta" } },
  });

  assert.equal(result.chatId, "120363@g.us");
  assert.equal(result.isGroup, true);
  assert.equal(result.senderJid, "12345@lid");
  assert.equal(result.senderLid, "12345@lid");
  assert.equal(result.phoneNumber, undefined);
});

test("normaliza legenda e mensagem citada sem confundir os IDs", () => {
  const result = normalizeMessage({
    key: { id: "reply-1", remoteJid: "5511888888888@s.whatsapp.net", fromMe: false },
    message: {
      extendedTextMessage: {
        text: "Minha resposta",
        contextInfo: {
          stanzaId: "original-1",
          participant: "5511777777777@s.whatsapp.net",
          quotedMessage: { imageMessage: { caption: "Mensagem original" } },
        },
      },
    },
  });

  assert.equal(result.messageId, "reply-1");
  assert.equal(result.quotedMessage.messageId, "original-1");
  assert.equal(result.quotedMessage.participantJid, "5511777777777@s.whatsapp.net");
  assert.equal(result.quotedMessage.text, "Mensagem original");
  assert.equal(result.quotedMessage.type, "imageMessage");
});

test("mantém encaminhamento distinto de citação", () => {
  const result = normalizeMessage({
    key: { id: "forwarded-1", remoteJid: "5511999999999@s.whatsapp.net" },
    message: { conversation: "Encaminhada", contextInfo: { isForwarded: true, forwardingScore: 2 } },
  });

  assert.equal(result.forwarded, true);
  assert.equal(result.quotedMessage, undefined);
});

test("desembrulha mensagens efêmeras e preserva o contexto interno", () => {
  const result = normalizeMessage({
    key: { id: "wrapped-1", remoteJid: "5511999999999@s.whatsapp.net" },
    message: { ephemeralMessage: { message: { extendedTextMessage: { text: "Embrulhada", contextInfo: { stanzaId: "wrapped-original", quotedMessage: { conversation: "Original" } } } } } },
  });

  assert.equal(result.type, "extendedTextMessage");
  assert.equal(result.text, "Embrulhada");
  assert.equal(result.quotedMessage.messageId, "wrapped-original");
});

