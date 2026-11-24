const sensitiveLibsignalMessages = new Set([
  "Closing session:",
  "Opening session:",
  "Session already closed",
  "Session already open",
]);

function installSensitiveLogFilter() {
  if (console.__apiWhatsappSensitiveLogFilterInstalled) return;
  const originalInfo = console.info.bind(console);
  const originalWarn = console.warn.bind(console);

  console.info = (first, ...rest) => {
    if (sensitiveLibsignalMessages.has(first)) {
      originalInfo("Baileys/libsignal atualizou uma sessão Signal");
      return;
    }
    originalInfo(first, ...rest);
  };

  console.warn = (first, ...rest) => {
    if (sensitiveLibsignalMessages.has(first)) {
      originalWarn("Baileys/libsignal reportou uma transição de sessão Signal");
      return;
    }
    originalWarn(first, ...rest);
  };

  Object.defineProperty(console, "__apiWhatsappSensitiveLogFilterInstalled", { value: true, configurable: false });
}

installSensitiveLogFilter();

module.exports = { installSensitiveLogFilter };
