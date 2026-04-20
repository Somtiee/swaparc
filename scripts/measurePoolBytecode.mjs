import fs from "node:fs";
import solc from "solc";

const sources = {
  "PoseidonT3.sol": { content: fs.readFileSync("contracts/PoseidonT3.sol", "utf8") },
  "ZKPrivacyPool.sol": { content: fs.readFileSync("contracts/ZKPrivacyPool.sol", "utf8") },
  "PrivPayGroth16Verifier.sol": { content: fs.readFileSync("contracts/PrivPayGroth16Verifier.sol", "utf8") },
};
const input = {
  language: "Solidity",
  sources,
  settings: {
    optimizer: { enabled: true, runs: 200 },
    outputSelection: {
      "*": {
        "*": ["evm.bytecode.object", "evm.deployedBytecode.object"],
      },
    },
  },
};
const out = JSON.parse(solc.compile(JSON.stringify(input)));
const errs = out.errors?.filter((e) => e.severity === "error") || [];
if (errs.length) {
  console.error(errs.map((e) => e.formattedMessage).join("\n"));
  process.exit(1);
}
const lib = out.contracts["PoseidonT3.sol"].PoseidonT3;
const pool = out.contracts["ZKPrivacyPool.sol"].ZKPrivacyPool;
const bc = pool.evm.bytecode.object;
const ph = bc.match(/__\$[^$]+\$__/g);
console.log("lib creation bytes", lib.evm.bytecode.object.length / 2);
console.log("lib runtime bytes", lib.evm.deployedBytecode.object.length / 2);
console.log("pool creation bytes", bc.length / 2);
console.log("pool runtime bytes", pool.evm.deployedBytecode.object.length / 2);
console.log("link placeholders", ph ? [...new Set(ph)] : "none");
