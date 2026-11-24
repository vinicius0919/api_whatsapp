function shouldMonitorMessage(normalized, { mode = "all", groups = [] } = {}) {
  if (!normalized?.messageId || normalized.fromMe || mode === "none") return false;
  if (mode === "allowlist") return Boolean(normalized.isGroup && groups.includes(normalized.chatId));
  return mode === "all";
}

module.exports = { shouldMonitorMessage };
