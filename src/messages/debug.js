const config = require("../config");

function canExposeIdentifiers({ chatId, isGroup } = {}) {
  if (!chatId) return false;
  if (config.monitorMode === "allowlist") return config.monitoredGroups.includes(chatId);
  return Boolean(isGroup && config.monitoredGroups.includes(chatId));
}

function safeDetails(details = {}) {
  const output = { ...details };
  if (!canExposeIdentifiers(output)) {
    delete output.messageId;
    delete output.chatId;
    delete output.remoteJid;
    delete output.senderJid;
    delete output.senderLid;
    delete output.phoneNumber;
    delete output.displayName;
    delete output.quotedMessage;
  }
  delete output.text;
  delete output.content;
  delete output.raw;
  delete output.message;
  delete output.update;
  delete output.error;
  return output;
}

function inboundDebug(stage, details = {}) {
  if (!config.debugInbound) return;
  console.info(`[INBOUND] ${stage}`, JSON.stringify(safeDetails(details)));
}

function safeErrorSummary(error) {
  const firstValidationError = error?.errors && Object.values(error.errors)[0];
  const path = error?.path || firstValidationError?.path;
  let reason = "PROCESSING_ERROR";
  if (error?.name === "ValidationError") reason = "VALIDATION_ERROR";
  if (error?.name === "CastError" || firstValidationError?.name === "CastError") reason = "CAST_ERROR";
  if (error?.code === 11000) reason = "DUPLICATE_KEY";
  return {
    errorName: error?.name || "Error",
    code: error?.code,
    path: typeof path === "string" ? path : undefined,
    reason,
    index: typeof error?.index === "string" ? error.index : undefined,
  };
}

module.exports = { inboundDebug, canExposeIdentifiers, safeErrorSummary };
