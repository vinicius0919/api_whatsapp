(() => {
  "use strict";

  let apiKey = "";
  let applicationId = "";
  let selectedSession = "";
  let pollTimer = null;
  let sessionCache = [];

  const $ = (id) => document.getElementById(id);
  const setHidden = (element, hidden) => { element.hidden = hidden; };
  const showError = (element, message) => { element.textContent = message; element.hidden = !message; };
  const sessionLabel = (state) => ({ connected: "Conectada", qr_required: "Aguardando QR", connecting: "Conectando", reconnecting: "Reconectando", disconnected: "Desconectada", logged_out: "Desconectada", error: "Erro" }[state] || state || "Indisponível");
  const pillClass = (state) => state === "connected" ? "connected" : ["error"].includes(state) ? "error" : "waiting";

  async function request(url, options = {}) {
    const headers = new Headers(options.headers || {});
    if (apiKey) headers.set("x-api-key", apiKey);
    if (applicationId) headers.set("x-application-id", applicationId);
    headers.set("x-whatsapp-session", selectedSession || "default");
    const response = await fetch(url, { ...options, headers, cache: "no-store" });
    let body = null;
    try { body = await response.json(); } catch {}
    if (!response.ok) {
      const error = new Error(body?.message || "Não foi possível consultar o Gateway");
      error.status = response.status;
      throw error;
    }
    return body;
  }

  function stopPolling() { if (pollTimer) clearInterval(pollTimer); pollTimer = null; }

  function renderSessions() {
    const container = $("sessions");
    container.replaceChildren();
    if (!sessionCache.length) { container.textContent = "Nenhuma sessão autorizada encontrada."; return; }
    sessionCache.forEach((session) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `session${session.id === selectedSession ? " selected" : ""}`;
      const info = document.createElement("span");
      info.className = "session-name";
      const name = document.createElement("strong"); name.textContent = session.name || session.id;
      const id = document.createElement("small"); id.textContent = session.id;
      info.append(name, id);
      const state = document.createElement("span"); state.className = `pill ${pillClass(session.status)}`; state.textContent = sessionLabel(session.status);
      button.append(info, state);
      button.addEventListener("click", () => selectSession(session.id));
      container.append(button);
    });
  }

  function renderStatus(health, ready) {
    $("http-status").textContent = health?.status === "ok" ? "Operacional" : "Indisponível";
    $("mongo-status").textContent = ready?.mongo ? "Conectado" : "Indisponível";
    $("ready-status").textContent = ready?.status === "ready" ? "Pronto" : "Aguardando dependências";
  }

  async function refreshDashboard() {
    try {
      const [health, ready, sessions] = await Promise.all([fetch("/health", { cache: "no-store" }).then((r) => r.json()), fetch("/ready", { cache: "no-store" }).then((r) => r.json()), request("/api/v1/sessions")]);
      renderStatus(health, ready);
      sessionCache = sessions;
      if (!selectedSession && sessions[0]) selectedSession = sessions[0].id;
      if (selectedSession && !sessions.some((session) => session.id === selectedSession)) selectedSession = sessions[0]?.id || "";
      renderSessions();
      if (selectedSession) await refreshQr();
      showError($("dashboard-error"), "");
    } catch (error) {
      if (error.status === 401 || error.status === 403) logout("A API Key não possui acesso administrativo.");
      else showError($("dashboard-error"), error.message);
    }
  }

  async function refreshQr() {
    if (!selectedSession) return;
    try {
      const data = await request(`/api/v1/sessions/${encodeURIComponent(selectedSession)}/qr`);
      $("selected-title").textContent = data.id || selectedSession;
      $("qr-status").textContent = data.status === "connected" ? "Sessão conectada com sucesso." : data.qr ? "Escaneie o QR Code pelo celular." : `Status: ${sessionLabel(data.status)}`;
      $("connect-session").disabled = !["created", "disconnected", "logged_out", "error", "stopped"].includes(data.status);
      $("refresh-qr").disabled = false;
      if (typeof data.qr === "string" && data.qr.startsWith("data:image/")) { $("qr-image").src = data.qr; setHidden($("qr-container"), false); }
      else { $("qr-image").removeAttribute("src"); setHidden($("qr-container"), true); }
      if (data.status === "connected") stopPolling();
    } catch (error) { showError($("dashboard-error"), error.message); }
  }

  function selectSession(id) { stopPolling(); selectedSession = id; renderSessions(); refreshQr(); pollTimer = setInterval(refreshQr, 3000); }

  async function connectSession() {
    if (!selectedSession) return;
    $("connect-session").disabled = true;
    try { await request(`/api/v1/sessions/${encodeURIComponent(selectedSession)}/connect`, { method: "POST" }); await refreshQr(); }
    catch (error) { showError($("dashboard-error"), error.message); $("connect-session").disabled = false; }
  }

  function logout(message = "") {
    stopPolling(); apiKey = ""; applicationId = ""; selectedSession = ""; sessionCache = [];
    $("login-form").reset(); setHidden($("login-view"), false); setHidden($("dashboard-view"), true); showError($("login-error"), message);
  }

  $("login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    apiKey = $("api-key").value.trim(); applicationId = $("application-id").value.trim();
    try { await request("/admin/api/auth"); setHidden($("login-view"), true); setHidden($("dashboard-view"), false); showError($("login-error"), ""); await refreshDashboard(); }
    catch (error) { apiKey = ""; showError($("login-error"), error.status === 403 ? "A API Key não possui permissão administrativa." : "API Key inválida ou Gateway indisponível."); }
  });
  $("logout").addEventListener("click", () => logout());
  $("refresh-sessions").addEventListener("click", refreshDashboard);
  $("refresh-qr").addEventListener("click", refreshQr);
  $("connect-session").addEventListener("click", connectSession);
})();
