const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");

function runNode(source, variables = {}) {
  const env = { ...process.env };
  delete env.TRUST_PROXY;
  delete env.RATE_LIMIT_MAX;
  delete env.MESSAGE_RATE_LIMIT_MAX;
  for (const [name, value] of Object.entries(variables)) env[name] = value;
  return spawnSync(process.execPath, ["-e", source], { encoding: "utf8", env });
}

function lastOutputLine(result) {
  return result.stdout.trim().split(/\r?\n/).at(-1);
}

test("usa trust proxy 0 por padrão e registra o valor antes dos limitadores", () => {
  const result = runNode(`
    const app = require('./src/app');
    if (app.get('trust proxy') !== 0) process.exit(1);
    process.stdout.write(String(app.get('trust proxy fn')('203.0.113.10', 0)));
  `);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(lastOutputLine(result), "false");
});

test("aceita trust proxy 1 para um único proxy confiável", () => {
  const result = runNode(`
    const app = require('./src/app');
    if (app.get('trust proxy') !== 1) process.exit(1);
    process.stdout.write(String(app.get('trust proxy fn')('203.0.113.10', 0)));
  `, { TRUST_PROXY: "1" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(lastOutputLine(result), "true");
});

test("rejeita valores de trust proxy fora de 0 e 1", () => {
  const result = runNode("require('./src/config')", { TRUST_PROXY: "true" });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /TRUST_PROXY deve ser 0 ou 1/);
});

test("req.ip usa o endereço encaminhado somente quando o proxy está explicitamente confiável", () => {
  const source = `
    const express = require('express');
    const request = require('supertest');
    const config = require('./src/config');
    const probe = express();
    probe.set('trust proxy', config.trustProxy);
    probe.get('/', (req, res) => res.json({ ip: req.ip, ips: req.ips }));
    request(probe).get('/').set('X-Forwarded-For', '203.0.113.10').end((error, response) => {
      if (error) throw error;
      process.stdout.write(JSON.stringify(response.body));
    });
  `;
  const local = runNode(source, { TRUST_PROXY: "0" });
  assert.equal(local.status, 0, local.stderr);
  assert.notEqual(JSON.parse(lastOutputLine(local)).ip, "203.0.113.10");

  const railway = runNode(source, { TRUST_PROXY: "1" });
  assert.equal(railway.status, 0, railway.stderr);
  assert.equal(JSON.parse(lastOutputLine(railway)).ip, "203.0.113.10");
});

test("não confia em mais de um salto X-Forwarded-For com TRUST_PROXY=1", () => {
  const result = runNode(`
    const express = require('express');
    const request = require('supertest');
    const app = express();
    app.set('trust proxy', 1);
    app.get('/', (req, res) => res.json({ ip: req.ip, ips: req.ips }));
    request(app).get('/').set('X-Forwarded-For', '203.0.113.10, 198.51.100.20').end((error, response) => {
      if (error) throw error;
      process.stdout.write(JSON.stringify(response.body));
    });
  `, { TRUST_PROXY: "1" });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(lastOutputLine(result)), { ip: "198.51.100.20", ips: ["198.51.100.20"] });
});

test("limiter global continua ativo atrás do proxy", () => {
  const result = runNode(`
    const request = require('supertest');
    const app = require('./src/app');
    (async () => {
      const first = await request(app).get('/health').set('X-Forwarded-For', '203.0.113.10');
      const second = await request(app).get('/health').set('X-Forwarded-For', '203.0.113.10');
      process.stdout.write(JSON.stringify({ first: first.status, second: second.status }));
    })().catch(error => { console.error(error); process.exit(1); });
  `, { TRUST_PROXY: "1", RATE_LIMIT_MAX: "1" });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(lastOutputLine(result)), { first: 200, second: 429 });
});

test("autenticação administrativa e de aplicação permanece independente do trust proxy", () => {
  const result = runNode(`
    const fs = require('node:fs');
    const os = require('node:os');
    const path = require('node:path');
    const request = require('supertest');
    const { hashApiKey } = require('./src/auth');
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'trust-proxy-auth-')), 'keys.json');
    fs.writeFileSync(file, JSON.stringify({ keys: [
      { id: 'admin', role: 'admin', keyHash: hashApiKey('admin-key'), applications: ['*'], sessions: ['*'] },
      { id: 'app', role: 'application', keyHash: hashApiKey('app-key'), applications: ['billing'], sessions: ['default'] }
    ] }));
    process.env.API_KEY_STORE = file;
    delete require.cache[require.resolve('./src/config')];
    delete require.cache[require.resolve('./src/auth')];
    delete require.cache[require.resolve('./src/app')];
    const app = require('./src/app');
    (async () => {
      const admin = await request(app).get('/admin/api/auth').set('x-api-key', 'admin-key').set('x-application-id', 'admin');
      const application = await request(app).get('/api/v1/sessions').set('x-api-key', 'app-key').set('x-application-id', 'billing').set('x-whatsapp-session', 'default');
      process.stdout.write(JSON.stringify({ admin: admin.status, application: application.status }));
    })().catch(error => { console.error(error); process.exit(1); });
  `, { TRUST_PROXY: "1" });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(lastOutputLine(result)), { admin: 200, application: 200 });
});
