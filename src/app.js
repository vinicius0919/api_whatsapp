const express = require("express");
const cors = require("cors");

const messageRoutes = require("../routes/messages");
const groupRoutes = require("../routes/groups");

const app = express();

app.use(cors());
app.use(express.json());

app.use("/messages", messageRoutes);

app.use("/groups", groupRoutes);

app.get("/health", (req, res) => {
  res.json({ status: "ok", whatsapp: "running" });
});

module.exports = app;
