import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { keccak256, stringToHex, parseAbi } from "viem";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = fileURLToPath(new URL("../../", import.meta.url));
const read = async (p) =>
  JSON.parse(await readFile(path.join(root, p), "utf8"));
const handoff = await read("web/config/deployment-handoff.json");
const vetted = await read("web/config/network-handoff.json");
export const canonical = (value) => JSON.stringify(sort(value));
function sort(value) {
  return Array.isArray(value)
    ? value.map(sort)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((k) => [k, sort(value[k])]),
        )
      : value;
}
if (
  handoff.chainId !== vetted.network.chainId ||
  Number(vetted.walletAddChain.chainId) !== handoff.chainId
)
  throw Error("Network/handoff mismatch");
if (
  handoff.manifest.hook.constructorArgs[0].toLowerCase() !==
  vetted.network.uniswapV4.poolManager
)
  throw Error("PoolManager mismatch");
await mkdir(path.join(root, "dist/abi"), { recursive: true });
const contracts = [];
for (const c of handoff.contracts) {
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(c.name)) throw Error("Invalid ABI name");
  const pinned = execFileSync(
    "git",
    ["show", `${handoff.sourceCommit}:docs/abi/${c.name}.json`],
    { cwd: root },
  );
  const local = await readFile(path.join(root, `docs/abi/${c.name}.json`));
  if (!local.equals(pinned))
    throw Error(`ABI differs from pinned implementation: ${c.name}`);
  const abi = JSON.parse(pinned);
  const hash = keccak256(stringToHex(canonical(abi))).slice(2);
  if (hash !== c.abiHash) throw Error(`ABI hash mismatch: ${c.name} (${hash})`);
  const abiPath = `abi/${c.name}.json`;
  await writeFile(path.join(root, "dist", abiPath), pinned);
  contracts.push({
    name: c.name,
    address: c.address,
    abiHash: c.abiHash,
    abiPath,
  });
}
// Public protocol interfaces. Addresses are ONLY read from the vetted network block.
const protocolAbi = parseAbi([
  "struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }",
  "struct QuoteExactSingleParams { PoolKey poolKey; bool zeroForOne; uint128 exactAmount; bytes hookData; }",
  "function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96,int24 tick,uint24 protocolFee,uint24 lpFee)",
  "function getLiquidity(bytes32 poolId) view returns (uint128)",
  "function quoteExactInputSingle(QuoteExactSingleParams params) returns (uint256 amountOut,uint256 gasEstimate)",
  "function execute(bytes commands,bytes[] inputs,uint256 deadline) payable",
  "function allowance(address user,address token,address spender) view returns (uint160 amount,uint48 expiration,uint48 nonce)",
  "function approve(address token,address spender,uint160 amount,uint48 expiration)",
  "error ExecutionFailed(uint256 commandIndex,bytes message)",
  "error V4TooLittleReceived(uint256 minAmountOutReceived,uint256 amountReceived)",
  "error PartialFill()",
]);
await writeFile(
  path.join(root, "dist/abi/Uniswap.json"),
  JSON.stringify(protocolAbi, null, 2) + "\n",
);
const assets = [];
async function walk(dir = "") {
  for (const entry of (
    await readdir(path.join(root, "dist", dir), { withFileTypes: true })
  ).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) await walk(p);
    else if (p !== "imd-deployment.json") {
      const bytes = await readFile(path.join(root, "dist", p));
      if (bytes.length > 8388608) throw Error("Asset too large");
      assets.push({
        path: p,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
    }
  }
}
await walk();
if (assets.length > 128) throw Error("Too many assets");
const manifest = {
  version: 1,
  launchId: handoff.launchId,
  chainId: handoff.chainId,
  sourceCommit: handoff.sourceCommit,
  attestationHash: handoff.attestationHash,
  contracts,
  assets,
  network: vetted.network,
  walletAddChain: vetted.walletAddChain,
  pool: handoff.manifest.pool,
  token: handoff.manifest.token,
  deploymentBlock: Math.min(...handoff.contracts.map((c) => c.blockNumber)),
  protocolAbiPath: "abi/Uniswap.json",
};
await writeFile(
  path.join(root, "dist/imd-deployment.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log(
  `Verified pinned ABIs and exported deployment manifest with ${assets.length} assets.`,
);
