import {
  encodeAbiParameters,
  isAddress,
  keccak256,
  parseAbiParameters,
  parseUnits,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import type { Config, Provider } from "./config";
export const poolType =
  "(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)";
export function poolKey(c: Config) {
  const currencies = [c.deployment.pool.pairedCurrency, c.token.address].sort(
    (a, b) => a.toLowerCase().localeCompare(b.toLowerCase()),
  );
  return {
    currency0: currencies[0],
    currency1: currencies[1],
    fee: c.deployment.pool.fee,
    tickSpacing: c.deployment.pool.tickSpacing,
    hooks: c.hook.address,
  };
}
export function poolId(c: Config) {
  return keccak256(
    encodeAbiParameters(parseAbiParameters(poolType), [poolKey(c)]),
  );
}
export function referral(raw: string | null, c: Config, account?: Address) {
  if (!raw)
    return {
      data: "0x" as Hex,
      address: undefined,
      valid: false,
      message: "No referral link. No referral fee.",
    };
  if (!isAddress(raw))
    return {
      data: "0x" as Hex,
      address: undefined,
      valid: false,
      message: "This referral address is invalid. No referral fee.",
    };
  const excluded = [
    zeroAddress,
    c.hook.address,
    c.deployment.network.uniswapV4.poolManager,
    account,
  ]
    .filter(Boolean)
    .map((a) => a!.toLowerCase());
  const valid = !excluded.includes(raw.toLowerCase());
  return {
    data: encodeAbiParameters([{ type: "address" }], [raw]),
    address: raw as Address,
    valid,
    message: valid
      ? "This swap supports the referrer in your link."
      : "This address is excluded from rewards. No referral fee.",
  };
}
export function amountIn(text: string, decimals: number) {
  if (
    !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(text) ||
    (text.split(".")[1]?.length ?? 0) > decimals
  )
    throw Error(
      `Enter a positive amount with up to ${decimals} decimal places.`,
    );
  const value = parseUnits(text, decimals);
  if (value <= 0n || value > 2n ** 128n - 1n)
    throw Error("Enter a positive amount within the swap limit.");
  return value;
}
export function minimumOut(amount: bigint, slippage: string) {
  if (!/^\d+(\.\d{1,2})?$/.test(slippage))
    throw Error(
      "Enter slippage from 0.1% to 5%, with at most two decimal places.",
    );
  const bps = Math.round(Number(slippage) * 100);
  if (bps < 10 || bps > 500) throw Error("Choose slippage from 0.1% to 5%.");
  const minimum = (amount * BigInt(10000 - bps)) / 10000n;
  if (minimum <= 0n)
    throw Error(
      "This amount is too small to quote safely. Increase the amount.",
    );
  return minimum;
}
export function swapPayload(
  c: Config,
  buy: boolean,
  input: bigint,
  minimum: bigint,
  hookData: Hex,
) {
  const key = poolKey(c),
    zeroForOne = buy
      ? key.currency0 === c.deployment.pool.pairedCurrency
      : key.currency0 === c.token.address;
  const inputCurrency = zeroForOne ? key.currency0 : key.currency1,
    outputCurrency = zeroForOne ? key.currency1 : key.currency0;
  const params = [
    encodeAbiParameters(
      parseAbiParameters(
        `(${poolType} poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,bytes hookData)`,
      ),
      [
        {
          poolKey: key,
          zeroForOne,
          amountIn: input,
          amountOutMinimum: minimum,
          hookData,
        },
      ],
    ),
    encodeAbiParameters(parseAbiParameters("address,uint256"), [
      inputCurrency,
      input,
    ]),
    encodeAbiParameters(parseAbiParameters("address,uint256"), [
      outputCurrency,
      minimum,
    ]),
  ];
  return {
    commands: "0x10" as Hex,
    inputs: [
      encodeAbiParameters(parseAbiParameters("bytes,bytes[]"), [
        "0x060c0f",
        params,
      ]),
    ],
    value: inputCurrency === zeroAddress ? input : 0n,
    zeroForOne,
  };
}
export async function switchChain(provider: Provider, c: Config) {
  const chainId = c.deployment.walletAddChain.chainId;
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId }],
    });
  } catch (error) {
    const e = error as {
      code?: number;
      message?: string;
      data?: { originalError?: { code?: number } };
    };
    if (
      e.code !== 4902 &&
      e.data?.originalError?.code !== 4902 &&
      !/unknown chain|unrecognized chain|chain.*not.*added/i.test(
        e.message ?? "",
      )
    )
      throw error;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [c.deployment.walletAddChain],
    });
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId }],
    });
  }
}
export function errorText(error: unknown) {
  const e = error as { shortMessage?: string; message?: string; code?: number };
  return e.code === 4001 || /user rejected|user denied/i.test(e.message ?? "")
    ? "Request declined in your wallet. You can try again."
    : (
        e.shortMessage ??
        e.message ??
        "Request failed. Check your connection and try again."
      ).slice(0, 600);
}
