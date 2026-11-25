// routes/qr.js
const express = require("express");
const router = express.Router();

const { getLastQr, getSessionStatus } = require("../src/whatsapp");

router.get("/", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const sessionId = req.auth.sessionId;
  const qr = getLastQr(sessionId);
  if (!qr) {
    return res.json(getSessionStatus(sessionId));
  }

  res.send(`
    <html>
      <body style="display:flex;align-items:center;justify-content:center;height:100vh">
        <img alt="WhatsApp QR Code" src="${qr}" />
      </body>
    </html>
  `);
});

module.exports = router;
