const path = require("node:path");
const dotenv = require("dotenv");

const backendEnv = path.resolve(__dirname, "../../req-services/backend-req-services/.env.homologation");
dotenv.config({ path: backendEnv, override: true });

const gatewayUrl = (process.env.GATEWAY_URL || "http://127.0.0.1:3003").replace(/\/$/, "");
const applicationId = process.env.WHATSAPP_APPLICATION_ID || "default";
const sessionId = process.env.WHATSAPP_SESSION_ID || "default";
const targetUrl = process.env.WHATSAPP_WEBHOOK_URL || "http://127.0.0.1:3000/webhooks/whatsapp";
const apiKey = process.env.WHATSAPP_API_KEY;

if (!apiKey) throw new Error("WHATSAPP_API_KEY não encontrado no ambiente de homologação");

const headers = {
  "x-api-key": apiKey,
  "x-application-id": applicationId,
  "x-whatsapp-session": sessionId,
  "content-type": "application/json",
};

async function request(pathname, options = {}) {
  const response = await fetch(`${gatewayUrl}${pathname}`, { ...options, headers: { ...headers, ...options.headers } });
  const body = await response.text();
  let parsed;
  try { parsed = body ? JSON.parse(body) : null; } catch { parsed = body; }
  if (!response.ok) throw new Error(`${options.method || "GET"} ${pathname} falhou (${response.status}): ${parsed?.message || body}`);
  return parsed;
}

async function main() {
  const subscriptions = await request("/api/v1/webhooks");
  const candidates = subscriptions.filter((item) => item.applicationId === applicationId && item.enabled !== false && item.events?.includes("message.received"));
  if (candidates.length !== 1) {
    throw new Error(`Esperada exatamente uma subscription ativa de message.received para ${applicationId}; encontradas ${candidates.length}`);
  }

  const [subscription] = candidates;
  if (subscription.url === targetUrl) {
    console.log(`Subscription ${subscription.id} já aponta para o backend direto.`);
    return;
  }

  const updated = await request(`/api/v1/webhooks/${encodeURIComponent(subscription.id)}`, {
    method: "PATCH",
    body: JSON.stringify({ url: targetUrl }),
  });
  console.log(`Subscription ${updated.id} atualizada para ${updated.url}; eventos e identificadores foram preservados.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
