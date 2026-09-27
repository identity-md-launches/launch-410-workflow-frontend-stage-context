import {
  createPublicClient,
  custom,
  defineChain,
  fallback,
  http,
  isAddress,
  keccak256,
  stringToHex,
  type Abi,
  type Address,
  type EIP1193Provider,
} from "viem";
export type Provider = EIP1193Provider & {
  on?: (event: string, listener: (value: unknown) => void) => void;
  removeListener?: (event: string, listener: (value: unknown) => void) => void;
};
declare global {
  interface Window {
    ethereum?: Provider;
  }
}
export type Deployment = {
  version: 1;
  launchId: string;
  chainId: number;
  sourceCommit: string;
  attestationHash: string;
  contracts: {
    name: string;
    address: Address;
    abiHash: string;
    abiPath: string;
  }[];
  assets: { path: string; sha256: string }[];
  network: {
    chainId: number;
    name: string;
    testnet: boolean;
    rpcUrls: string[];
    explorer: string;
    nativeCurrency: { name: string; symbol: string; decimals: number };
    faucets: string[];
    uniswapV4: Record<
      | "poolManager"
      | "universalRouter"
      | "quoter"
      | "stateView"
      | "positionManager"
      | "permit2",
      Address
    >;
  };
  walletAddChain: {
    chainId: `0x${string}`;
    chainName: string;
    rpcUrls: string[];
    nativeCurrency: { name: string; symbol: string; decimals: number };
    blockExplorerUrls: string[];
  };
  pool: {
    fee: number;
    tickSpacing: number;
    pairedCurrency: Address;
    initialPrice: string;
  };
  token: { name: string; symbol: string; decimals: number; contract: string };
  deploymentBlock: number;
  protocolAbiPath: string;
};
export function canonical(value: unknown): string {
  const sort = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(sort)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((k) => [k, sort((v as Record<string, unknown>)[k])]),
          )
        : v;
  return JSON.stringify(sort(value));
}
export function assetURL(path: string) {
  if (
    !path ||
    path.startsWith("/") ||
    path.includes("..") ||
    path.includes(":") ||
    path.includes("\\")
  )
    throw Error("Unsafe deployment asset path");
  return new URL(path, new URL("./", window.location.href)).href;
}
async function jsonFile(path: string, expectedHash?: string) {
  const response = await fetch(assetURL(path));
  if (!response.ok)
    throw Error(`Could not load ${path}. Reload the page to retry.`);
  const bytes = await response.arrayBuffer();
  if (expectedHash) {
    const hash = [
      ...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    ]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    if (hash !== expectedHash)
      throw Error(
        `Asset verification failed for ${path}. Reload the deployment.`,
      );
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}
export async function loadConfig() {
  const d = (await jsonFile("imd-deployment.json")) as Deployment;
  if (
    d.version !== 1 ||
    d.chainId !== d.network.chainId ||
    Number(d.walletAddChain.chainId) !== d.chainId ||
    !d.network.testnet ||
    !d.assets.some((a) => a.path === "index.html") ||
    d.assets.length > 128
  )
    throw Error(
      "Deployment configuration is inconsistent. Transactions are disabled.",
    );
  for (const address of [
    ...d.contracts.map((c) => c.address),
    ...Object.values(d.network.uniswapV4),
  ])
    if (!isAddress(address)) throw Error("Invalid deployment address");
  const contracts = await Promise.all(
    d.contracts.map(async (c) => {
      const abi = (await jsonFile(c.abiPath)) as Abi;
      if (
        !Array.isArray(abi) ||
        keccak256(stringToHex(canonical(abi))).slice(2) !== c.abiHash
      )
        throw Error(
          `ABI verification failed for ${c.name}. Transactions are disabled.`,
        );
      return { ...c, abi: abi as Abi };
    }),
  );
  const token = contracts.find((c) => c.name === d.token.contract),
    hook = contracts.find((c) => c.name === "ReferralHook");
  if (!token || !hook || d.contracts.length !== 2)
    throw Error("Incomplete deployment contract set");
  const protocolHash = d.assets.find(
    (asset) => asset.path === d.protocolAbiPath,
  )?.sha256;
  if (!protocolHash)
    throw Error("Protocol ABI is missing from the deployment inventory.");
  const protocolAbi = (await jsonFile(d.protocolAbiPath, protocolHash)) as Abi;
  const chain = defineChain({
    id: d.chainId,
    name: d.network.name,
    nativeCurrency: d.network.nativeCurrency,
    rpcUrls: { default: { http: d.network.rpcUrls } },
    blockExplorers: { default: { name: "Explorer", url: d.network.explorer } },
    testnet: d.network.testnet,
  });
  return { deployment: d, token, hook, protocolAbi, chain };
}
export type Config = Awaited<ReturnType<typeof loadConfig>>;
export function publicClient(c: Config, provider?: Provider) {
  return createPublicClient({
    chain: c.chain,
    transport: fallback(
      [
        ...c.deployment.network.rpcUrls.map((url) =>
          http(url, { timeout: 7000, retryCount: 0 }),
        ),
        ...(provider ? [custom(provider, { retryCount: 0 })] : []),
      ],
      { retryCount: 0 },
    ),
  });
}
