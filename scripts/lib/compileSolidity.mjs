import fs from "node:fs";
import path from "node:path";
import solc from "solc";

/**
 * Compile Solidity sources with node_modules imports (OpenZeppelin).
 * @param {Record<string, string>} sources map of virtual path -> source
 * @param {{ optimizer?: boolean, runs?: number }} [opts]
 */
export function compileSolidity(sources, opts = {}) {
  const root = process.cwd();
  const input = {
    language: "Solidity",
    sources: Object.fromEntries(
      Object.entries(sources).map(([k, v]) => [k, { content: v }])
    ),
    settings: {
      optimizer: {
        enabled: opts.optimizer !== false,
        runs: opts.runs ?? 200,
      },
      outputSelection: {
        "*": {
          "*": ["abi", "evm.bytecode.object"],
        },
      },
    },
  };

  function findImports(importPath) {
    const candidates = [
      path.join(root, "node_modules", importPath),
      path.join(root, importPath),
    ];
    for (const filePath of candidates) {
      if (fs.existsSync(filePath)) {
        return { contents: fs.readFileSync(filePath, "utf8") };
      }
    }
    return { error: `File not found: ${importPath}` };
  }

  const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));
  if (output.errors?.length) {
    const fatals = output.errors.filter((e) => e.severity === "error");
    if (fatals.length) {
      throw new Error(fatals.map((e) => e.formattedMessage).join("\n"));
    }
  }
  return output.contracts;
}

export function getArtifact(contracts, sourceName, contractName) {
  const artifact = contracts[sourceName]?.[contractName];
  if (!artifact?.abi || !artifact?.evm?.bytecode?.object) {
    throw new Error(`Missing artifact for ${sourceName}:${contractName}`);
  }
  return {
    abi: artifact.abi,
    bytecode: artifact.evm.bytecode.object,
  };
}
