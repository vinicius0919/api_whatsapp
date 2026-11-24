const mongoose = require("mongoose");
const config = require("./config");

async function connectMongo() {
  if (mongoose.connection.readyState === 1) return mongoose.connection;
  // Índices de produção são controlados pelo script de migração explícito.
  // Isso evita que uma inicialização tente reconciliar automaticamente índices legados.
  await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: config.mongoServerSelectionTimeoutMs, autoIndex: false });
  return mongoose.connection;
}

async function disconnectMongo() {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
}

function isMongoReady() {
  return mongoose.connection.readyState === 1;
}

module.exports = { mongoose, connectMongo, disconnectMongo, isMongoReady };
