const { mongoose } = require("../db");

const schema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, index: true },
  name: { type: String, required: true, trim: true },
  enabled: { type: Boolean, default: true, index: true },
  permissions: { type: [String], default: [] },
  allowedSessionIds: { type: [String], default: [] },
  apiKeyHashes: { type: [String], default: [] },
}, { timestamps: true, versionKey: false });

module.exports = mongoose.models.Application || mongoose.model("Application", schema);
