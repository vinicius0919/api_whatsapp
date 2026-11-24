const WRAPPER_KEYS = [
  "ephemeralMessage",
  "viewOnceMessage",
  "viewOnceMessageV2",
  "viewOnceMessageV2Extension",
  "documentWithCaptionMessage",
  "editedMessage",
  "associatedChildMessage",
  "deviceSentMessage",
];

function unwrapContent(content) {
  let current = content && typeof content === "object" ? content : {};
  const contexts = [];

  for (let depth = 0; depth < 8; depth += 1) {
    if (current.contextInfo) contexts.push(current.contextInfo);
    const wrapperKey = WRAPPER_KEYS.find((key) => current[key]?.message);
    if (!wrapperKey) {
      const nestedContext = Object.values(current).find((value) => value && typeof value === "object" && value.contextInfo)?.contextInfo;
      if (nestedContext) contexts.push(nestedContext);
      break;
    }
    current = current[wrapperKey].message || {};
  }

  return { content: current, contextInfo: contexts.find((context) => context?.stanzaId) || contexts.find(Boolean) || current.contextInfo || {} };
}

function messageType(content) {
  return Object.keys(content || {}).find((key) => key !== "contextInfo") || "unknown";
}

function textFromContent(content) {
  if (!content || typeof content !== "object") return undefined;
  return content.conversation
    || content.extendedTextMessage?.text
    || content.imageMessage?.caption
    || content.videoMessage?.caption
    || content.documentMessage?.caption
    || content.documentWithCaptionMessage?.message?.documentMessage?.caption
    || content.buttonsResponseMessage?.selectedDisplayText
    || content.listResponseMessage?.title
    || content.templateButtonReplyMessage?.selectedDisplayText;
}

function contentForStorage(content) {
  const text = textFromContent(content);
  if (typeof text !== "string") return undefined;
  const type = messageType(content);
  if (type === "extendedTextMessage") return { extendedTextMessage: { text } };
  if (type === "imageMessage") return { imageMessage: { caption: text } };
  if (type === "videoMessage") return { videoMessage: { caption: text } };
  if (type === "documentMessage") return { documentMessage: { caption: text } };
  return { conversation: text };
}

function jidParts(jid) {
  if (typeof jid !== "string" || !jid) return { jid: undefined, lid: undefined, phoneNumber: undefined };
  const normalized = jid.trim();
  const isLid = normalized.endsWith("@lid");
  const isPhone = normalized.endsWith("@s.whatsapp.net") || normalized.endsWith("@c.us");
  return {
    jid: normalized,
    lid: isLid ? normalized : undefined,
    phoneNumber: isPhone ? normalized.split("@")[0] : undefined,
  };
}

function normalizeQuotedMessage(contextInfo, chatId) {
  const messageId = contextInfo?.stanzaId;
  if (!messageId) return undefined;

  const participant = jidParts(contextInfo.participant);
  const quotedContent = contextInfo.quotedMessage || {};
  const unwrapped = unwrapContent(quotedContent);
  const quotedChat = jidParts(contextInfo.remoteJid || chatId);

  return {
    messageId,
    chatId: quotedChat.jid,
    participantJid: participant.jid,
    participantLid: participant.lid,
    type: messageType(unwrapped.content),
    text: textFromContent(unwrapped.content),
  };
}

function normalizeMessage(message) {
  const key = message?.key || {};
  const chat = jidParts(key.remoteJid);
  const participant = jidParts(key.participant || (key.fromMe ? undefined : key.remoteJid));
  const senderLid = jidParts(key.senderLid || key.participantLid || (participant.lid ? participant.jid : undefined));
  const { content, contextInfo } = unwrapContent(message?.message || {});
  const type = messageType(content);
  const timestampValue = Number(message?.messageTimestamp);
  const timestamp = new Date((Number.isFinite(timestampValue) ? timestampValue : Math.floor(Date.now() / 1000)) * 1000);
  const id = key.id;

  return {
    messageId: id,
    chatId: chat.jid || "unknown",
    remoteJid: chat.jid || "unknown",
    senderJid: participant.jid,
    senderLid: senderLid.lid,
    phoneNumber: participant.phoneNumber || senderLid.phoneNumber,
    displayName: typeof message?.pushName === "string" ? message.pushName : undefined,
    isGroup: Boolean(chat.jid?.endsWith("@g.us")),
    fromMe: Boolean(key.fromMe),
    type,
    text: textFromContent(content),
    timestamp,
    quotedMessage: normalizeQuotedMessage(contextInfo, chat.jid),
    forwarded: Boolean(contextInfo?.isForwarded || contextInfo?.forwardingScore),
    content: contentForStorage(content),
  };
}

module.exports = { normalizeMessage, unwrapContent, textFromContent, messageType, contentForStorage };
