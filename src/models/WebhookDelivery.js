const { mongoose } = require("../db");

const schema = new mongoose.Schema({
  eventId: { type: String, required: true },
  subscriptionId: { type: String, required: true },
  status: { type: String, enum: ["pending", "delivered", "failed"], default: "pending", index: true },
  attempts: { type: Number, default: 0 },
  nextAttemptAt: { type: Date, index: true },
  lastError: String,
  deliveredAt: Date,
}, { timestamps: true, versionKey: false });

schema.index({ eventId: 1, subscriptionId: 1 }, { unique: true });
schema.index({ status: 1, nextAttemptAt: 1 });

module.exports = mongoose.models.WebhookDelivery || mongoose.model("WebhookDelivery", schema);
