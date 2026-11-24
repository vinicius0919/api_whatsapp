const { mongoose } = require("../db");

const schema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, index: true },
  applicationId: { type: String, required: true, index: true },
  url: { type: String, required: true },
  enabled: { type: Boolean, default: true, index: true },
  events: { type: [String], default: [] },
  secretCiphertext: { type: String, required: true },
}, { timestamps: true, versionKey: false });

schema.index({ applicationId: 1, enabled: 1 });

module.exports = mongoose.models.WebhookSubscription || mongoose.model("WebhookSubscription", schema);
