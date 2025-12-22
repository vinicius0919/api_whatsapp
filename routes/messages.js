const express = require("express");
const router = express.Router();

const { sendTextMessage } = require("../src/sendMessage");

router.post("/send", async (req, res) => {
  const { number, message } = req.body;

  try {
    const jid = `${number}@s.whatsapp.net`;
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
