import {
  createWalletClient,
  custom,
  formatUnits,
  type Address,
  type Hash,
  type Hex,
} from "viem";
import { publicClient, type Config, type Provider } from "./config";
import { poolId, poolKey, swapPayload } from "./domain";
export type Client = ReturnType<typeof publicClient>;
export async function verifyDeployment(c: Config, client: Client) {
  if ((await client.getChainId()) !== c.deployment.chainId)
    throw Error(
      "RPC returned the wrong chain. Retry with a connected Sepolia wallet.",
    );
  const n = c.deployment.network.uniswapV4;
  const addresses = [
    c.token.address,
    c.hook.address,
    n.poolManager,
    n.stateView,
    n.quoter,
    n.universalRouter,
    n.permit2,
  ];
  const codes = await Promise.all(
    addresses.map((address) => client.getCode({ address })),
  );
  if (codes.some((code) => !code || code === "0x"))
    throw Error(
      "A configured contract has no deployed code. Transactions are disabled.",
    );
  const manager = (await client.readContract({
    address: c.hook.address,
    abi: c.hook.abi,
    functionName: "poolManager",
  })) as Address;
  if (manager.toLowerCase() !== n.poolManager.toLowerCase())
    throw Error("Hook PoolManager verification failed.");
}
export type State = {
  block: bigint;
  updated: number;
  decimals: number;
  symbol: string;
  totalSupply: bigint;
  sqrtPrice: bigint;
  liquidity: bigint;
  price: string;
  feeBps: bigint;
  ethBalance?: bigint;
  tokenBalance?: bigint;
  claimable?: bigint;
  volume?: bigint;
  count?: bigint;
  poolEarned?: bigint;
  tokenAllowance?: bigint;
  routerAllowance?: bigint;
  expiration?: number;
};
export async function readState(
  c: Config,
  client: Client,
  account?: Address,
): Promise<State> {
  const block = await client.getBlockNumber({ cacheTime: 0 }),
    n = c.deployment.network.uniswapV4;
  const token = (functionName: string, args: unknown[] = []) =>
    client.readContract({
      address: c.token.address,
      abi: c.token.abi,
      functionName,
      args,
      blockNumber: block,
    });
  const hook = (functionName: string, args: unknown[] = []) =>
    client.readContract({
      address: c.hook.address,
      abi: c.hook.abi,
      functionName,
      args,
      blockNumber: block,
    });
  const [decimals, symbol, totalSupply, slot, liquidity, fee] =
    await Promise.all([
      token("decimals"),
      token("symbol"),
      token("totalSupply"),
      client.readContract({
        address: n.stateView,
        abi: c.protocolAbi,
        functionName: "getSlot0",
        args: [poolId(c)],
        blockNumber: block,
      }),
      client.readContract({
        address: n.stateView,
        abi: c.protocolAbi,
        functionName: "getLiquidity",
        args: [poolId(c)],
        blockNumber: block,
      }),
      hook("FEE_BPS"),
    ]);
  const sqrtPrice = (slot as readonly [bigint, number, number, number])[0];
  if (
    Number(decimals) !== c.deployment.token.decimals ||
    symbol !== c.deployment.token.symbol
  )
    throw Error("Token metadata does not match the deployment.");
  const priceScaled =
    (((sqrtPrice * sqrtPrice * 10n ** 18n) / 2n ** 192n) *
      10n ** BigInt(c.deployment.network.nativeCurrency.decimals)) /
    10n ** BigInt(Number(decimals));
  const state: State = {
    block,
    updated: Date.now(),
    decimals: Number(decimals),
    symbol: symbol as string,
    totalSupply: totalSupply as bigint,
    sqrtPrice,
    liquidity: liquidity as bigint,
    price: formatUnits(priceScaled, 18),
    feeBps: fee as bigint,
  };
  if (account) {
    const [
      ethBalance,
      tokenBalance,
      claimable,
      volume,
      count,
      poolStats,
      tokenAllowance,
      permit,
    ] = await Promise.all([
      client.getBalance({ address: account, blockNumber: block }),
      token("balanceOf", [account]),
      hook("balanceOf", [account]),
      hook("referredVolume", [account]),
      hook("referralCount", [account]),
      hook("poolReferrals", [poolId(c), account]),
      token("allowance", [account, n.permit2]),
      client.readContract({
        address: n.permit2,
        abi: c.protocolAbi,
        functionName: "allowance",
        args: [account, c.token.address, n.universalRouter],
        blockNumber: block,
      }),
    ]);
    Object.assign(state, {
      ethBalance,
      tokenBalance,
      claimable,
      volume,
      count,
      poolEarned: (poolStats as bigint[])[2],
      tokenAllowance,
      routerAllowance: (permit as bigint[])[0],
      expiration: Number((permit as bigint[])[1]),
    });
  }
  return state;
}
export type Activity = {
  type: "Referred" | "Claimed";
  referrer: Address;
  amount: bigint;
  tx: Hash;
  block: bigint;
  index: number;
};
export async function readActivity(c: Config, client: Client, block: bigint) {
  const from = block > 1999n ? block - 1999n : 0n;
  const results = await Promise.all(
    ["Referred", "Claimed"].map((eventName) =>
      client.getContractEvents({
        address: c.hook.address,
        abi: c.hook.abi,
        eventName,
        fromBlock: from,
        toBlock: block,
        strict: true,
      }),
    ),
  );
  return results
    .flatMap((logs, i) =>
      logs.map((log) => {
        const args = (log as unknown as { args: Record<string, unknown> }).args;
        return {
          type: i === 0 ? "Referred" : "Claimed",
          referrer: args.referrer as Address,
          amount: (args.reward ?? args.amount) as bigint,
          tx: log.transactionHash!,
          block: log.blockNumber!,
          index: log.logIndex!,
        } as Activity;
      }),
    )
    .sort((a, b) =>
      a.block === b.block ? b.index - a.index : a.block > b.block ? -1 : 1,
    )
    .slice(0, 8);
}
export async function quote(
  c: Config,
  client: Client,
  account: Address,
  buy: boolean,
  input: bigint,
  hookData: Hex,
) {
  const key = poolKey(c);
  const { result } = await client.simulateContract({
    address: c.deployment.network.uniswapV4.quoter,
    abi: c.protocolAbi,
    functionName: "quoteExactInputSingle",
    args: [{ poolKey: key, zeroForOne: buy, exactAmount: input, hookData }],
    account,
  });
  const output = (result as [bigint, bigint])[0];
  if (output <= 0n || output > 2n ** 128n - 1n)
    throw Error("No usable quote. Try a smaller amount or refresh the pool.");
  return output;
}
export async function assertWallet(
  provider: Provider,
  c: Config,
  account: Address,
) {
  const [chain, accounts] = await Promise.all([
    provider.request({ method: "eth_chainId" }),
    provider.request({ method: "eth_accounts" }),
  ]);
  if (
    Number(chain) !== c.deployment.chainId ||
    accounts[0]?.toLowerCase() !== account.toLowerCase()
  )
    throw Error("Your wallet changed. Reconnect and review the action again.");
}
export async function transact(
  c: Config,
  client: Client,
  provider: Provider,
  account: Address,
  action: "claim" | "tokenApproval" | "routerApproval" | "swap",
  input: bigint,
  buy: boolean,
  minimum: bigint,
  hookData: Hex,
  onStatus: (text: string, hash?: Hash) => void,
) {
  await assertWallet(provider, c, account);
  await verifyDeployment(c, client);
  const n = c.deployment.network.uniswapV4,
    now = Math.floor(Date.now() / 1000);
  const payload = swapPayload(c, buy, input, minimum, hookData);
  const call =
    action === "claim"
      ? {
          address: c.hook.address,
          abi: c.hook.abi,
          functionName: "claim",
          args: [],
        }
      : action === "tokenApproval"
        ? {
            address: c.token.address,
            abi: c.token.abi,
            functionName: "approve",
            args: [n.permit2, input],
          }
        : action === "routerApproval"
          ? {
              address: n.permit2,
              abi: c.protocolAbi,
              functionName: "approve",
              args: [c.token.address, n.universalRouter, input, now + 3600],
            }
          : {
              address: n.universalRouter,
              abi: c.protocolAbi,
              functionName: "execute",
              args: [payload.commands, payload.inputs, BigInt(now + 300)],
              value: payload.value,
            };
  onStatus("Simulating the transaction…");
  const { request } = await client.simulateContract({ ...call, account });
  await assertWallet(provider, c, account);
  onStatus("Confirm the transaction in your wallet.");
  const wallet = createWalletClient({
    chain: c.chain,
    transport: custom(provider),
    account,
  });
  const hash = await wallet.writeContract(request);
  onStatus("Transaction submitted. Waiting for confirmation…", hash);
  const receipt = await client.waitForTransactionReceipt({
    hash,
    timeout: 120000,
  });
  if (receipt.status !== "success")
    throw Error(
      "Transaction reverted. Open the transaction for details, then refresh before retrying.",
    );
  onStatus("Transaction confirmed. Balances updated.", hash);
  return hash;
}
