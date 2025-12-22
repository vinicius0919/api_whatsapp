const express = require("express");
const router = express.Router();
const { getGroups } = require("../src/whatsapp");
const { sendTextMessage } = require("../src/sendMessage");
function normalizeJid(input) {
  if (!input || typeof input !== "string") {
    throw new Error("JID inválido: valor ausente");
  }

  const jid = input.trim();

  // Grupo
  if (/^\d+@g\.us$/.test(jid)) {
    return jid;
  }

  // Contato
  if (/^\d+$/.test(jid)) {
    return `${jid}@s.whatsapp.net`;
  }

  // Contato já formatado
  if (/^\d+@s\.whatsapp\.net$/.test(jid)) {
    return jid;
  }

  throw new Error(`JID inválido: ${jid}`);
}

module.exports = { normalizeJid };


router.get("/", async (req, res) => {
  try {
    const groups = await getGroups();
    res.json(groups);
  } catch (err) {
    res.status(500).json({ error: "WhatsApp not connected" });
  }
});

router.post("/send", async (req, res) => {
  const { number, message } = req.body;
  try {
    const jid = normalizeJid(number);

    console.log(jid, message)
    await sendTextMessage(jid, message);

    return res.json({ success: true });
  } catch (err) {
    console.error("❌ ERRO REAL:", err);

    return res.status(500).json({
      error: err.message || "unknown error",
    });
  }
});

module.exports = router;
