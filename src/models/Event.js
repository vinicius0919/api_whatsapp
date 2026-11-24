const { mongoose } = require("../db");

const schema = new mongoose.Schema({
  eventId: { type: String, required: true, unique: true, index: true },
  sessionId: { type: String, required: true, index: true },
  type: { type: String, required: true, index: true },
  payload: { type: mongoose.Schema.Types.Mixed, required: true },
  createdAt: { type: Date, default: Date.now, index: true },
}, { versionKey: false });

module.exports = mongoose.models.Event || mongoose.model("Event", schema);
