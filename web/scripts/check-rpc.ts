import { readFile, writeFile } from "node:fs/promises";
import {
  createPublicClient,
  http,
  keccak256,
  encodeAbiParameters,
  parseAbiParameters,
} from "viem";
import { swapPayload } from "../src/domain";
import type { Config } from "../src/config";
const root = new URL("../../", import.meta.url);
const d = JSON.parse(
  await readFile(new URL("dist/imd-deployment.json", root), "utf8"),
);
const abi = JSON.parse(
  await readFile(new URL("dist/abi/Uniswap.json", root), "utf8"),
);
const hook = d.contracts.find((c: any) => c.name === "ReferralHook");
const token = d.contracts.find((c: any) => c.name === "REFR");
const hookAbi = JSON.parse(
  await readFile(new URL(`dist/${hook.abiPath}`, root), "utf8"),
);
const key = {
  currency0: d.pool.pairedCurrency,
  currency1: token.address,
  fee: d.pool.fee,
  tickSpacing: d.pool.tickSpacing,
  hooks: hook.address,
};
const id = keccak256(
  encodeAbiParameters(
    parseAbiParameters(
      "(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)",
    ),
    [key],
  ),
);
const results = [];
for (const url of d.network.rpcUrls) {
  const client = createPublicClient({
    transport: http(url, { timeout: 9000, retryCount: 0 }),
  });
  try {
    const chain = await client.getChainId();
    if (chain !== d.chainId) throw Error("Wrong chain ID");
    const block = await client.getBlockNumber();
    const addresses = [
      ...d.contracts,
      ...Object.entries(d.network.uniswapV4).map(([name, address]) => ({
        name,
        address,
      })),
    ];
    const contracts = await Promise.all(
      addresses.map(async ({ name, address }: any) => ({
        name,
        address,
        codeBytes: ((await client.getCode({ address }))?.length ?? 2) / 2 - 1,
      })),
    );
    const manager = await client.readContract({
      address: hook.address,
      abi: hookAbi,
      functionName: "poolManager",
    });
    const slot = await client.readContract({
      address: d.network.uniswapV4.stateView,
      abi,
      functionName: "getSlot0",
      args: [id],
    });
    const liquidity = await client.readContract({
      address: d.network.uniswapV4.stateView,
      abi,
      functionName: "getLiquidity",
      args: [id],
    });
    let quoteResult: unknown;
    try {
      quoteResult = (
        await client.simulateContract({
          address: d.network.uniswapV4.quoter,
          abi,
          functionName: "quoteExactInputSingle",
          args: [
            {
              poolKey: key,
              zeroForOne: true,
              exactAmount: 100000000000000n,
              hookData: "0x",
            },
          ],
          account: "0x0000000000000000000000000000000000000001",
        })
      ).result;
    } catch (e) {
      quoteResult = { error: (e as Error).message.slice(0, 1200) };
    }
    let buySimulation: unknown;
    try {
      const value = 100000000000000n,
        minimum = 100n;
      const hookData = encodeAbiParameters(parseAbiParameters("address"), [
        "0x2222222222222222222222222222222222222222",
      ]);
      const p = swapPayload(
        { deployment: d, token, hook } as Config,
        true,
        value,
        minimum,
        hookData,
      );
      await client.simulateContract({
        address: d.network.uniswapV4.universalRouter,
        abi,
        functionName: "execute",
        args: [
          p.commands,
          p.inputs,
          BigInt(Math.floor(Date.now() / 1000) + 300),
        ],
        account: "0x1111111111111111111111111111111111111111",
        value: p.value,
        stateOverride: [
          {
            address: "0x1111111111111111111111111111111111111111",
            balance: 10n ** 18n,
          },
        ],
      });
      buySimulation = {
        success: true,
        method:
          "eth_call with hypothetical sender balance override; no signing or broadcast",
        inputWei: value,
        referrer: "0x2222222222222222222222222222222222222222",
      };
    } catch (e) {
      buySimulation = {
        success: false,
        error: (e as Error).message.slice(0, 1500),
      };
    }
    results.push({
      url,
      chain,
      block,
      contracts,
      manager,
      poolId: id,
      slot,
      liquidity,
      quoteResult,
      buySimulation,
    });
  } catch (e) {
    results.push({ url, error: (e as Error).message.slice(0, 1000) });
  }
}
const report = {
  checkedAt: new Date().toISOString(),
  mode: "read-only; no transactions signed or broadcast",
  results,
};
await writeFile(
  new URL("docs/frontend/rpc-check.json", root),
  JSON.stringify(
    report,
    (_, v) => (typeof v === "bigint" ? v.toString() : v),
    2,
  ) + "\n",
);
console.log(
  JSON.stringify(
    report,
    (_, v) => (typeof v === "bigint" ? v.toString() : v),
    2,
  ),
);
