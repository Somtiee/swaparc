import { registerEntitySecretCiphertext } from "@circle-fin/developer-controlled-wallets";

const apiKey = "TEST_API_KEY:8b90b7e5cb17385ebe34354d54d9b31e:6042764adc03fb97ec8d13f8c62d5bfd";

// paste the secret you saw in terminal:
const entitySecret = "d3e3ad6136de49b682b508132298fe293562bb7fca66af99d71f18392517d8c2";

const response = await registerEntitySecretCiphertext({
  apiKey,
  entitySecret,
  recoveryFileDownloadPath: "./recovery",
});

console.log("REGISTER RESPONSE:", response);
