import { readFile } from "node:fs/promises";
import {
  decodeFunctionData,
  encodeFunctionResult,
  encodeEventTopics,
  encodeAbiParameters,
  parseAbiParameters,
  toHex,
} from "viem";
export const account = "0x1111111111111111111111111111111111111111";
export const referrer = "0x2222222222222222222222222222222222222222";
export const txHash = "0x" + "ab".repeat(32);
const root = new URL("../../", import.meta.url);
export async function fixture(page, options = {}) {
  const d = JSON.parse(
    await readFile(new URL("dist/imd-deployment.json", root), "utf8"),
  );
  const deployed = await Promise.all(
    d.contracts.map(async (c) => ({
      ...c,
      abi: JSON.parse(
        await readFile(new URL("dist/" + c.abiPath, root), "utf8"),
      ),
    })),
  );
  const token = deployed.find((c) => c.name === "REFR"),
    hook = deployed.find((c) => c.name === "ReferralHook");
  const protocol = JSON.parse(
    await readFile(new URL("dist/abi/Uniswap.json", root), "utf8"),
  );
  const state = {
    calls: [],
    transactions: [],
    tokenAllowance: 0n,
    routerAllowance: 0n,
    expiration: 0,
    claimable: 4200000000000000n,
    failReads: false,
    failSimulate: false,
    failQuote: false,
    delayQuote: 0,
    emptyPool: false,
    ...options,
  };
  const readAbi = (address) =>
    address.toLowerCase() === token.address.toLowerCase()
      ? token.abi
      : address.toLowerCase() === hook.address.toLowerCase()
        ? hook.abi
        : protocol;
  const reply = (abi, functionName, result) =>
    encodeFunctionResult({ abi, functionName, result });
  async function rpc(body) {
    state.calls.push(body);
    switch (body.method) {
      case "eth_chainId":
        return toHex(d.chainId);
      case "eth_blockNumber":
        return toHex(11800000);
      case "eth_getCode":
        return state.missingCode ? "0x" : "0x6001600155";
      case "eth_getBalance":
        return toHex(2n * 10n ** 18n);
      case "eth_getTransactionCount":
        return "0x1";
      case "eth_estimateGas":
        return "0x40000";
      case "eth_gasPrice":
        return "0x3b9aca00";
      case "eth_getLogs": {
        const referred =
          body.params[0].topics?.[0] ===
          encodeEventTopics({ abi: hook.abi, eventName: "Referred" })[0];
        return [
          {
            address: hook.address,
            blockHash: "0x" + "cc".repeat(32),
            blockNumber: toHex(11799999),
            transactionHash: txHash,
            transactionIndex: "0x0",
            logIndex: referred ? "0x0" : "0x1",
            removed: false,
            topics: referred
              ? encodeEventTopics({
                  abi: hook.abi,
                  eventName: "Referred",
                  args: { referrer, poolId: "0x" + "dd".repeat(32) },
                })
              : encodeEventTopics({
                  abi: hook.abi,
                  eventName: "Claimed",
                  args: { referrer },
                }),
            data: referred
              ? encodeAbiParameters(parseAbiParameters("uint256,uint256"), [
                  10n ** 18n,
                  2n * 10n ** 15n,
                ])
              : encodeAbiParameters(parseAbiParameters("uint256"), [
                  10n ** 15n,
                ]),
          },
        ];
      }
      case "eth_getTransactionReceipt":
        return {
          transactionHash: txHash,
          transactionIndex: "0x0",
          blockHash: "0x" + "cc".repeat(32),
          blockNumber: toHex(11800000),
          from: account,
          to: hook.address,
          cumulativeGasUsed: "0x10000",
          gasUsed: "0x10000",
          effectiveGasPrice: "0x3b9aca00",
          contractAddress: null,
          logs: [],
          logsBloom: "0x" + "00".repeat(256),
          status: "0x1",
          type: "0x2",
        };
      case "eth_sendTransaction": {
        const tx = body.params[0];
        state.transactions.push(tx);
        const { functionName, args } = decodeFunctionData({
          abi: readAbi(tx.to),
          data: tx.data,
        });
        if (functionName === "claim") state.claimable = 0n;
        if (
          functionName === "approve" &&
          tx.to.toLowerCase() === token.address.toLowerCase()
        )
          state.tokenAllowance = args[1];
        if (
          functionName === "approve" &&
          tx.to.toLowerCase() === d.network.uniswapV4.permit2.toLowerCase()
        ) {
          state.routerAllowance = args[2];
          state.expiration = Number(args[3]);
        }
        return txHash;
      }
      case "eth_call": {
        if (state.failReads) throw Error("RPC temporarily unavailable");
        const call = body.params[0],
          abi = readAbi(call.to),
          { functionName: fn, args } = decodeFunctionData({
            abi,
            data: call.data,
          });
        if (state.failSimulate && ["execute", "claim", "approve"].includes(fn))
          throw Error("execution reverted: test simulation failure");
        const result =
          fn === "poolManager"
            ? d.network.uniswapV4.poolManager
            : fn === "decimals"
              ? 18
              : fn === "symbol"
                ? "REFR"
                : fn === "totalSupply"
                  ? 10n ** 27n
                  : fn === "FEE_BPS"
                    ? 20n
                    : fn === "getSlot0"
                      ? [state.emptyPool ? 0n : 2n ** 96n * 100n, 0, 0, 3000]
                      : fn === "getLiquidity"
                        ? state.emptyPool
                          ? 0n
                          : 10n ** 24n
                        : fn === "balanceOf"
                          ? call.to.toLowerCase() === hook.address.toLowerCase()
                            ? state.claimable
                            : 2500n * 10n ** 18n
                          : fn === "referredVolume"
                            ? 2100000000000000000n
                            : fn === "referralCount"
                              ? 12n
                              : fn === "poolReferrals"
                                ? [2100000000000000000n, 12n, 4200000000000000n]
                                : fn === "allowance"
                                  ? call.to.toLowerCase() ===
                                    token.address.toLowerCase()
                                    ? state.tokenAllowance
                                    : [
                                        state.routerAllowance,
                                        state.expiration,
                                        0,
                                      ]
                                  : fn === "claim"
                                    ? state.claimable
                                    : fn === "approve"
                                      ? call.to.toLowerCase() ===
                                        token.address.toLowerCase()
                                        ? true
                                        : undefined
                                      : undefined;
        if (fn === "quoteExactInputSingle") {
          if (state.delayQuote)
            await new Promise((r) => setTimeout(r, state.delayQuote));
          if (state.failQuote)
            throw Error("execution reverted: quote unavailable");
          return reply(abi, fn, [
            args[0].zeroForOne
              ? args[0].exactAmount * 9950n
              : args[0].exactAmount / 10050n,
            130000n,
          ]);
        }
        return reply(abi, fn, result);
      }
      default:
        throw Error("Unhandled mock RPC method " + body.method);
    }
  }
  await page.route("**/*", async (route) => {
    const url = route.request().url();
    if (
      !d.network.rpcUrls.some((r) => url.startsWith(r)) &&
      !url.endsWith("/__wallet_tx")
    )
      return route.continue();
    const body = route.request().postDataJSON();
    try {
      const result = await rpc(body);
      await route.fulfill({
        json: { jsonrpc: "2.0", id: body.id, result },
        headers: { "access-control-allow-origin": "*" },
      });
    } catch (e) {
      await route.fulfill({
        json: {
          jsonrpc: "2.0",
          id: body.id,
          error: { code: -32000, message: e.message },
        },
        headers: { "access-control-allow-origin": "*" },
      });
    }
  });
  if (options.wallet !== false)
    await page.addInitScript(
      ({ account, chainId, connected, unknown }) => {
        const listeners = {};
        window.__wallet = {
          account,
          chain: connected ? chainId : "0x1",
          connected,
          unknown,
          reject: false,
          requests: [],
        };
        window.__emit = (event, value) => {
          for (const f of listeners[event] ?? []) f(value);
        };
        window.ethereum = {
          on: (event, f) => {
            (listeners[event] ??= []).push(f);
          },
          removeListener: (event, f) => {
            listeners[event] = (listeners[event] ?? []).filter((v) => v !== f);
          },
          request: async (args) => {
            const w = window.__wallet;
            w.requests.push(args);
            if (args.method === "eth_accounts")
              return w.connected ? [w.account] : [];
            if (args.method === "eth_requestAccounts") {
              if (w.reject)
                throw { code: 4001, message: "User rejected request" };
              w.connected = true;
              return [w.account];
            }
            if (args.method === "eth_chainId") return w.chain;
            if (args.method === "wallet_switchEthereumChain") {
              if (w.unknown) throw { code: 4902, message: "Unknown chain" };
              w.chain = args.params[0].chainId;
              window.__emit("chainChanged", w.chain);
              return null;
            }
            if (args.method === "wallet_addEthereumChain") {
              w.unknown = false;
              return null;
            }
            if (args.method === "eth_sendTransaction") {
              if (w.reject)
                throw { code: 4001, message: "User rejected request" };
              const response = await fetch("./__wallet_tx", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ jsonrpc: "2.0", id: 1, ...args }),
              });
              return (await response.json()).result;
            }
            throw Error("Unhandled mock wallet request " + args.method);
          },
        };
      },
      {
        account,
        chainId: toHex(d.chainId),
        connected: options.connected ?? false,
        unknown: options.unknown ?? true,
      },
    );
  return { state, deployment: d, token, hook, protocol };
}
