const { mongoose } = require("../db");

const schema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, index: true },
  name: { type: String, required: true, trim: true },
  role: { type: String, enum: ["application", "admin"], default: "application", index: true },
  enabled: { type: Boolean, default: true, index: true },
  permissions: { type: [String], default: [] },
  allowedSessionIds: { type: [String], default: [] },
  apiKeyHashes: { type: [String], default: [] },
}, { timestamps: true, versionKey: false });

module.exports = mongoose.models.Application || mongoose.model("Application", schema);
