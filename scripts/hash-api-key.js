const { hashApiKey } = require("../src/auth");

const apiKey = process.argv[2];
if (!apiKey) {
  console.error("Uso: npm run hash-api-key -- <api-key>");
  process.exit(1);
}

console.log(hashApiKey(apiKey));
