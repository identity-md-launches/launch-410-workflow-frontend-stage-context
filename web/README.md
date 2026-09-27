# Referral frontend

One static React/TypeScript page for the deployed Referral token and ReferralHook. It reads the native ETH/REFR pool through StateView, builds `?ref=address` links, quotes exact-input buys and sells, obtains explicit sell approvals, and claims the connected wallet's referral ETH. No backend, credentials, wallet keys, deployment or publication step is included.

## Install, build and preview

Use Node 22.12+ (validated on Node 24.21.0) and npm. From the repository root:

```sh
npm ci --prefix web --cache /tmp/referral-npm-cache
npm run build --prefix web
npm run preview --prefix web
```

Open the localhost URL printed by Vite. The committed production export is the entire repository-root `dist/` directory. Serve it over HTTP(S), not `file://`. All assets and configuration are relative; no server rewrites are required. `npm run dev --prefix web` offers hot reload after the first build; its middleware serves the generated manifest/ABIs from `dist/`. Rebuild after configuration changes.

## Deployment configuration and ABI binding

`web/config/deployment-handoff.json` and `web/config/network-handoff.json` preserve the supplied public handoffs for reproducible builds after the temporary `.imd/reads` inputs disappear. These are build inputs, not an independent runtime address map. Do not edit attested identifiers to point at unrelated deployments.

`web/scripts/export.mjs` runs after Vite has finished exporting. For every handoff contract it obtains `docs/abi/<name>.json` using `git show <sourceCommit>:...`, compares the local export byte-for-byte, parses the raw ABI array and checks its canonical Keccak-256 hash. Canonicalization recursively sorts object keys, preserves array order and emits compact JSON. The script copies the exact ABI bytes into `dist/abi/`, exports the protocol interfaces, inventories every exported file other than the manifest, and writes SHA-256 hashes into `dist/imd-deployment.json`.

The source commit must exist in the local Git object database. The build deliberately fails if it is unavailable or the pinned ABI differs. No Solidity compilation or contract edits are necessary for this frontend stage.

The manifest carries the complete attested contract set, original identifiers, unchanged `network` object, exact `walletAddChain` parameters, pool/token metadata, deployment block and protocol ABI path. `web/src/config.ts` loads that same manifest and referenced ABIs at runtime. It rechecks deployed ABI canonical hashes and the protocol ABI's declared SHA-256. HTTPS or localhost is required for Web Crypto and clipboard support; clipboard failure still leaves a selectable referral URL. Manifest verification binds the supplied artifacts; it is not an independent signature verifier.

Public reads use the three configured RPCs, followed by the injected wallet provider only when the wallet is on Sepolia. Transactions remain disabled until the RPC chain ID, deployed code, hook PoolManager and token metadata have been checked. Code presence and manager checks do not independently prove runtime bytecode equivalence to the attestation.

## Wallet and transaction flow

An injected EIP-1193 browser wallet is supported without a WalletConnect project ID. Connect, switch network and disconnect are visible controls. A missing chain triggers `wallet_addEthereumChain` with the exact handoff parameters, then another switch. No private keys are accepted. Multiple-wallet discovery, WalletConnect and smart-account/bundler flows are not implemented or tested.

1. Enter a positive exact-input amount and slippage between 0.1% and 5%. Values use onchain token decimals; excessive precision is rejected rather than rounded.
2. Get a simulated `quoteExactInputSingle` quote from the configured quoter, including the referral data and connected sender. The quote expires after 30 seconds; changing account, chain, amount, direction or slippage invalidates it.
3. For a sell, approve only the input amount of REFR to the configured Permit2, then authorize only that amount for the configured Universal Router for one hour. Each is a separate simulated transaction and button step. Requote after each approval.
4. Review minimum output and confirm the buy/sell. `execute` receives command `0x10`, actions `0x060c0f`, the exact input, referral `hookData`, minimum output in both swap and take, and a five-minute deadline. Native buys send the exact input as value; sells send no native value. Simulate before signing and recheck wallet chain/account immediately before each signature.
5. Observe confirmation or failure and follow the explorer link. Claims simulate `claim()` and pay the whole available ETH balance to the caller. Concurrent actions are locked. A timeout or reverted receipt is never reported as confirmation; the transaction link remains available.

The spot tick may have zero active liquidity while the swap crosses into a funded range. An initialized pool can therefore request a quote even when `getLiquidity()` is zero; quote and transaction simulation decide whether the trade is possible.

The page refreshes state and the latest 2,000 blocks of `Referred`/`Claimed` events every 30 seconds. Earnings, count and volume are lifetime contract views aggregated across supported pools; the event list is a bounded recent window, not a complete historical index. Failed RPC reads disable actions and retain the last block label. Use Refresh data to recover.

## Hook economics and limits

The fixed hook fee is 20 bps (0.2%) of the ETH fee base, credited entirely to a valid referrer. The pool's 0.3% fee is separate. No valid referrer means no hook fee. Buy fees reduce the input reaching the pool; sell fees reduce the ETH delivered. The quoter incorporates those deltas. Dust rounds down to zero, and partial fills revert.

The hook accepts exactly one canonical ABI-encoded address. Zero, the hook, PoolManager and `tx.origin` are excluded. The self-referral check is weak: a second wallet bypasses it and gets its own fee back, without creating a reward gain. `hookData` is unauthenticated; the swapper chooses whom to pay. Referral balances aggregate across supported native-ETH pools. A contract that rejects ETH prevents only its own claim. Unsolicited ERC-6909 donations can create inaccessible surplus, so the unconditional claims-equal-debt formulation has the qualification already recorded in the deployed handoff. There is no admin, mint, pause, upgrade or sweep control to expose.

## Conflicting assignment requirements

- The explicit allowed paths prohibit a root `DESIGN.md`. The complete implemented design record is delivered at `docs/DESIGN.md`. Root files and deployed Solidity source remain untouched.
- The workflow names PoolSwapTest, while the later acceptance rule requires every swap/quote/approval to use the unchanged network block. That block supplies Universal Router and Permit2, and no PoolSwapTest. This implementation follows the later network acceptance rule and uses Universal Router. It does **not** implement the incompatible PoolSwapTest route. An early clarification was offered; no answer was supplied during implementation. The route decision is explicit, not a silent address substitution.

## Validation

```sh
npm run typecheck --prefix web
npm test --prefix web
npm run build --prefix web
npm run check:export --prefix web
PLAYWRIGHT_BROWSERS_PATH=/tmp/referral-playwright npm exec --prefix web -- playwright install chromium
PLAYWRIGHT_BROWSERS_PATH=/tmp/referral-playwright npm run test:browser --prefix web
npm run check:rpc --prefix web
npm audit --prefix web --cache /tmp/referral-npm-cache
```

Browser tests start and close their own static server, serve the real `dist/` under `/preview/`, inject mock wallet/RPC responses, assert decoded transaction parameters, run axe and save screenshots/evidence in `docs/frontend/`. No test endpoint or mock is in the production build. `check:rpc` is read-only: it inspects live code, views, a quote and a buy `eth_call` with a hypothetical sender balance override. It never signs or broadcasts.

See `docs/frontend/VALIDATION.md`, `browser-check.json`, `rpc-check.json` and screenshots for measured results, corrections and untested behavior. Published URLs/CIDs, real-wallet swaps/claims and control-plane publication checks are not claimed.

## Packaging

Only `web/.gitignore` changes ignore behavior; its explicit path budget is one file at `web/.gitignore`. Its patterns exclude generated dependency/cache/test-report directories at every depth under `web/`. `node_modules`, npm caches, Playwright binaries and dependency archives are not delivery artifacts. Build output has eight declared assets, approximately 0.55 MB total before the small manifest, well inside the 8 MiB Git-bundle and checker response budgets. Keep source, lockfile, ABI exports, runtime assets and validation evidence together.

Protocol interface references: [Uniswap swap guide](https://developers.uniswap.org/docs/protocols/v4/guides/swapping/swapping), [Universal Router command reference](https://developers.uniswap.org/docs/protocols/universal-router/concepts/commands). The deployed interface was additionally exercised through the read-only simulation; current upstream source can evolve independently of this deployment.
