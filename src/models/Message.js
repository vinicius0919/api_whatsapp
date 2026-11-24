
const { mongoose } = require("../db");

const quotedMessageSchema = new mongoose.Schema(
  {
    messageId: String,
    chatId: String,
    participantJid: String,
    participantLid: String,
    type: String,
    text: String,
  },
  {
    _id: false,
    versionKey: false,
  }
);

const schema = new mongoose.Schema(
  {
    sessionId: { type: String, required: true, index: true },
    applicationId: { type: String, index: true },

    direction: {
      type: String,
      enum: ["inbound", "outbound"],
      required: true,
      index: true,
    },

    remoteJid: { type: String, required: true, index: true },
    chatId: { type: String, index: true },

    senderJid: String,
    senderLid: String,
    phoneNumber: String,
    displayName: String,

    isGroup: {
      type: Boolean,
      default: false,
      index: true,
    },

    whatsappMessageId: {
      type: String,
      required: true,
    },

    fromMe: { type: Boolean, required: true },
    type: { type: String, required: true },
    text: String,

    quotedMessage: {
      type: quotedMessageSchema,
      default: undefined,
    },

    forwarded: {
      type: Boolean,
      default: false,
    },

    content: {
      type: mongoose.Schema.Types.Mixed,
      select: false,
    },

    timestamp: {
      type: Date,
      required: true,
      index: true,
    },

    status: {
      type: String,
      enum: [
        "accepted",
        "sending",
        "sent",
        "delivered",
        "read",
        "failed",
      ],
      default: "accepted",
      index: true,
    },

    idempotencyKey: {
      type: String,
      index: true,
      sparse: true,
    },

    error: String,
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

schema.index(
  { sessionId: 1, whatsappMessageId: 1 },
  { unique: true }
);

schema.index(
  { sessionId: 1, applicationId: 1, idempotencyKey: 1 },
  {
    name: "sessionId_1_applicationId_1_idempotencyKey_1_partial",
    unique: true,
    partialFilterExpression: { idempotencyKey: { $type: "string" } },
  }
);

schema.index({ sessionId: 1, timestamp: -1 });

module.exports =
  mongoose.models.Message || mongoose.model("Message", schema);
