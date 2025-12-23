// routes/qr.js
const express = require("express");
const router = express.Router();

const { getLastQr } = require("../src/whatsapp");

router.get("/", (req, res) => {
  if (!getLastQr()) {
    return res.json({ status: "connected" });
  }

  res.send(`
    <html>
      <body style="display:flex;align-items:center;justify-content:center;height:100vh">
        <img src="${getLastQr()}" />
      </body>
    </html>
  `);
});

module.exports = router;
