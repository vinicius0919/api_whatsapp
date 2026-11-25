const express = require("express");
const { asyncRoute } = require("../../src/middleware");
const { createSubscription, listSubscriptions, updateSubscription, deleteSubscription } = require("../../src/services/webhookService");

const router = express.Router();

router.post("/", asyncRoute(async (req, res) => {
  const subscription = await createSubscription({ ...req.body, applicationId: req.auth.applicationId });
  res.status(201).json(subscription);
}));

router.get("/", asyncRoute(async (req, res) => res.json(await listSubscriptions(req.auth.applicationId))));

router.patch("/:id", asyncRoute(async (req, res) => {
  const { url, events, chatIds, secret } = req.body || {};
  res.json(await updateSubscription(req.auth.applicationId, req.params.id, { url, events, chatIds, secret }));
}));

router.delete("/:id", asyncRoute(async (req, res) => {
  await deleteSubscription(req.auth.applicationId, req.params.id);
  res.status(204).end();
}));

module.exports = router;
