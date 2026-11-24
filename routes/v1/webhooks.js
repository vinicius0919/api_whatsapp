const express = require("express");
const { asyncRoute } = require("../../src/middleware");
const { createSubscription, listSubscriptions, deleteSubscription } = require("../../src/services/webhookService");

const router = express.Router();

router.post("/", asyncRoute(async (req, res) => {
  const subscription = await createSubscription({ ...req.body, applicationId: req.auth.applicationId });
  res.status(201).json(subscription);
}));

router.get("/", asyncRoute(async (req, res) => res.json(await listSubscriptions(req.auth.applicationId))));

router.delete("/:id", asyncRoute(async (req, res) => {
  await deleteSubscription(req.auth.applicationId, req.params.id);
  res.status(204).end();
}));

module.exports = router;
