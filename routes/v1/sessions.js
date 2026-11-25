const express = require("express");
const { asyncRoute } = require("../../src/middleware");
const { requireApiKey, requireSessionAccess } = require("../../src/auth");
const { sessionManager } = require("../../src/whatsapp");
const { AppError } = require("../../src/errors");

const router = express.Router();

function authorize(req, id) {
  sessionManager.validateId(id);
  requireSessionAccess(req, id);
}

router.post("/", requireApiKey({ admin: true }), asyncRoute(async (req, res) => {
  const { id, name, enabled } = req.body || {};
  const session = await sessionManager.createSession({ id, name, enabled, ownerApplicationId: req.auth.applicationId });
  res.status(201).json(session);
}));

router.get("/", asyncRoute(async (req, res) => {
  const sessions = sessionManager.listSessions().filter((session) => req.auth.allowedSessionIds.includes("*") || req.auth.allowedSessionIds.includes(session.id));
  res.json(sessions);
}));

router.get("/:id", asyncRoute(async (req, res) => {
  authorize(req, req.params.id);
  res.json(sessionManager.getSessionStatus(req.params.id));
}));

router.post("/:id/connect", asyncRoute(async (req, res) => {
  authorize(req, req.params.id);
  await sessionManager.connectSession(req.params.id);
  res.status(202).json(sessionManager.getSessionStatus(req.params.id));
}));

router.get("/:id/qr", asyncRoute(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  authorize(req, req.params.id);
  const qr = sessionManager.getSessionQr(req.params.id);
  if (!qr) return res.json(sessionManager.getSessionStatus(req.params.id));
  return res.json({ ...sessionManager.getSessionStatus(req.params.id), qr });
}));

router.post("/:id/disconnect", asyncRoute(async (req, res) => {
  authorize(req, req.params.id);
  res.json(await sessionManager.disconnectSession(req.params.id));
}));

router.use((error, req, res, next) => next(error instanceof Error ? error : new AppError(500, "Falha na sessão", "SESSION_ERROR")));

module.exports = router;
