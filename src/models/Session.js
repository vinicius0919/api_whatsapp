const { mongoose } = require("../db");

const schema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, index: true },
  name: { type: String, required: true, trim: true },
  ownerApplicationId: { type: String, required: true, index: true },
  enabled: { type: Boolean, default: true, index: true },
  status: { type: String, enum: ["created", "connecting", "qr_required", "connected", "reconnecting", "disconnected", "logged_out", "error", "stopped"], default: "created", index: true },
  authStoragePath: { type: String, required: true },
  lastConnectedAt: Date,
  lastDisconnectedAt: Date,
}, { timestamps: true, versionKey: false });

schema.index({ ownerApplicationId: 1, id: 1 }, { unique: true });

module.exports = mongoose.models.Session || mongoose.model("Session", schema);
