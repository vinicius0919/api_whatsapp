const test = require("node:test");
const assert = require("node:assert/strict");
const { validateMessageBody } = require("../src/middleware");

function validate(body) {
  let result;
  validateMessageBody({ body }, null, (error) => { result = error; });
  return result;
}

test("valida corpo de envio", () => {
  assert.equal(validate({ number: "5511999999999", message: "Olá" }), undefined);
  assert.equal(validate({ number: "123@g.us", message: "Olá grupo" }), undefined);
  assert.equal(validate({ number: "", message: "Olá" }).code, "INVALID_NUMBER");
  assert.equal(validate({ number: "5511999999999", message: "" }).code, "INVALID_MESSAGE");
});
