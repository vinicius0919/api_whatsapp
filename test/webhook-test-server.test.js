const test = require("node:test");
const assert = require("node:assert/strict");
const { createWebhookTestServer } = require("../scripts/webhook-test-server");
const { signPayload } = require("../src/webhooks/security");

test("receptor local valida assinatura, timestamp e deduplicação", async () => {
  const secret = "webhook-test-secret-123456";
  const receiver = createWebhookTestServer({ port: 0, secret });
  await receiver.listen();
  const port = receiver.server.address().port;
  const event = { eventId: "evt-receiver-test", type: "message.received", sessionId: "default", data: { messageId: "m-1" } };
  const body = JSON.stringify(event);
  const timestamp = new Date().toISOString();
  const headers = { "content-type": "application/json", "x-webhook-timestamp": timestamp, "x-webhook-event-id": event.eventId, "x-webhook-signature": `sha256=${signPayload(secret, body, timestamp, event.eventId)}` };
  try {
    const first = await fetch(`http://127.0.0.1:${port}/webhook`, { method: "POST", headers, body });
    const second = await fetch(`http://127.0.0.1:${port}/webhook`, { method: "POST", headers, body });
    const invalid = await fetch(`http://127.0.0.1:${port}/webhook`, { method: "POST", headers: { ...headers, "x-webhook-signature": "sha256=wrong" }, body });
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(invalid.status, 401);
    assert.equal(receiver.received.length, 2);
    assert.equal(receiver.received[1].duplicate, true);
  } finally {
    await receiver.close();
  }
});
