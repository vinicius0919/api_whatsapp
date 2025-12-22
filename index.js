// const express = require("express")
// const { sendMessage } = require ("./src/sendMessage.js");

// const app = express()

// app.use(express.json())

// app.post("/send-message", async (req, res) => {
//   const { to, message } = req.body;

//   if (!to || !message) {
//     return res.status(400).json({ error: "to e message são obrigatórios" });
//   }

//   try {
//     const result = await sendMessage(to, message);
//     res.json(result);
//   } catch (e) {
//     res.status(500).json({ error: "Falha ao enviar mensagem" });
//   }
// });

// app.listen(3000, () => console.log("API rodando na porta 3000"));

// const { connectWhatsApp } = require("./src/whatsapp");
// const { sendTextMessage } = require("./src/sendMessage");

// async function start() {
//   await connectWhatsApp();

//   // ⏳ aguarda o login real (poll simples)
//   const waitForConnection = setInterval(async () => {
//     try {
//       await sendTextMessage(
//         "559193857637@s.whatsapp.net",
//         "Mensagem de teste 🚀"
//       );

//       clearInterval(waitForConnection);
//       console.log("✅ Teste concluído");
//     } catch (err) {
//       // ainda não conectado, ignora
//     }
//   }, 2000);
// }

// start();


const app = require("./src/app");
const { connectWhatsApp } = require("./src/whatsapp");

const PORT = 3000;

async function start() {
  await connectWhatsApp();

  app.listen(PORT, () => {
    console.log(`🚀 API REST rodando em http://localhost:${PORT}`);
  });
}

start();
