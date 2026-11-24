const { AppError } = require("./errors");

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function validateMessageBody(req, res, next) {
  const body = req.body || {};
  const number = body.number || body.to;
  const message = body.message || body.text;
  if (typeof number !== "string" || !/^\d+(?:@s\.whatsapp\.net|@g\.us)?$/.test(number.trim())) {
    return next(new AppError(400, "number deve ser um número ou JID WhatsApp válido", "INVALID_NUMBER"));
  }
  if (typeof message !== "string" || !message.trim() || message.length > 4096) {
    return next(new AppError(400, "message deve ser um texto entre 1 e 4096 caracteres", "INVALID_MESSAGE"));
  }
  return next();
}

function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  const statusCode = Number.isInteger(error.statusCode) ? error.statusCode : 500;
  if (statusCode >= 500) console.error("Erro interno", { code: error.code, message: error.message });
  return res.status(statusCode).json({ error: error.code || "INTERNAL_ERROR", message: statusCode >= 500 ? "Erro interno do servidor" : error.message });
}

module.exports = { asyncRoute, validateMessageBody, errorHandler };
