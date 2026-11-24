const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const config = require("./config");
const { requireApiKey } = require("./auth");
const { asyncRoute, errorHandler } = require("./middleware");

const messageRoutes = require("../routes/messages");
const groupRoutes = require("../routes/groups");
const qrroutes = require("../routes/qr");
const v1SessionRoutes = require("../routes/v1/sessions");
const v1MessageRoutes = require("../routes/v1/messages");
const v1WebhookRoutes = require("../routes/v1/webhooks");

const app = express();

const allowedOrigins = config.corsOrigin.split(",").map((origin) => origin.trim()).filter(Boolean);
app.use(cors({ origin: (origin, callback) => callback(null, !origin || allowedOrigins.includes(origin)) }));
app.use(express.json({ limit: "64kb" }));
app.use(rateLimit({ windowMs: config.rateLimitWindowMs, limit: config.rateLimitMax, standardHeaders: "draft-7", legacyHeaders: false }));

app.use("/messages", requireApiKey(), messageRoutes);

app.use("/groups", requireApiKey(), groupRoutes);

app.use("/qr", requireApiKey({ admin: true }), qrroutes);

app.use("/api/v1/sessions", requireApiKey(), v1SessionRoutes);
app.use("/api/v1/messages", requireApiKey(), v1MessageRoutes);
app.use("/api/v1/webhooks", requireApiKey(), v1WebhookRoutes);


app.get("/health", (req, res) => {
  const { getSessionStatus } = require("./whatsapp");
  const whatsapp = getSessionStatus();
  res.status(200).json({ status: "ok", whatsapp });
});

app.get("/ready", (req, res) => {
  const { getSessionStatus } = require("./whatsapp");
  const { isMongoReady } = require("./db");
  const whatsapp = getSessionStatus();
  const ready = isMongoReady() && whatsapp.state === "connected";
  res.status(ready ? 200 : 503).json({ status: ready ? "ready" : "not_ready", mongo: isMongoReady(), whatsapp });
});

app.use((req, res, next) => next({ statusCode: 404, code: "NOT_FOUND", message: "Rota não encontrada" }));
app.use(errorHandler);

module.exports = app;
