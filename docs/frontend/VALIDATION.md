# Frontend worker validation

## Scope, assumptions and completion

Implemented one static Vite/React/TypeScript page in `web/`, exported to root `dist/`. The existing deployed source and ABI exports were read, not changed. Runtime deployment binding uses `dist/imd-deployment.json`; its identifiers and exact two-contract set derive from the handoff pinned to source commit `c4a018ccd6d1d91285ee2a71320d8a156eee286c`.

The implementation and worker checks are complete for the network-configured frontend scope. The requested repository commit remains blocked: `git add -- web dist docs` failed because `.git/index.lock` is on a read-only filesystem. Files are delivered in the workspace for the submission collector. There are also two explicit specification conflicts: root `DESIGN.md` is prohibited by the overriding path budget, so design documentation is at `docs/DESIGN.md`; PoolSwapTest is named in the workflow but absent from the network block that later acceptance requires all swaps/quotes/approvals to use, so Universal Router is implemented. The literal root-path and PoolSwapTest requirements are not claimed as satisfied. No scope expansion, redeployment or publication was performed.

The design direction and use of an injected browser wallet were inferred. English and a single light theme are supported. No WalletConnect project ID, private RPC URL or credential is present. Primary controls are buy, sell, the two sell approvals, claim, connection/switching, referral creation/copy and refresh. Administrative controls do not exist in the implementation.

## Commands and outcomes

Executed on 2026-09-27 with Node 24.21.0, npm 11.19.0 and Chromium 145.0.7632.6:

| Check | Outcome |
| --- | --- |
| `npm run typecheck --prefix web` (also part of each build) | Passed, TypeScript strict mode |
| `npm run build --prefix web` | Passed; source commit ABI byte comparison and both canonical Keccak hashes matched |
| `npm test --prefix web` | 5 tests passed: referral encoding/exclusions, integer/slippage constraints, decoded buy/sell payloads, exact add-chain parameters and switch rejection |
| `npm run check:export --prefix web` | Passed: 8 assets, 547,467 bytes excluding manifest; exact file inventory, SHA-256, canonical ABI hashes, handoff identifiers/contract set, network/walletAddChain and relative base |
| `PLAYWRIGHT_BROWSERS_PATH=/tmp/referral-playwright npm run test:browser --prefix web` | 17 grouped checks passed against the actual production export at `/preview/`; see `browser-check.json` |
| `npm run check:rpc --prefix web` | Three configured RPCs answered on Sepolia; code, hook manager, pool reads, quote and native buy simulation checked; see `rpc-check.json` |
| `npm audit --prefix web --cache /tmp/referral-npm-cache` | 0 vulnerabilities after patch updates |

An initial TypeScript inference error was fixed before the first usable export. The first dependency selection produced npm advisories; Vite, viem and tsx were updated and the audit rerun. Vite still reports a non-failing 500 kB chunk warning: the main module is approximately 509 kB uncompressed / 158 kB gzip, and the whole export is approximately 0.55 MB. No dependencies were removed to hide required assets.

The browser test creates its own server and closes it and Chromium in a `finally` block. The separate installed browser tool opened the production `/preview/` export with real public RPCs at desktop and mobile widths. Following the favicon correction, the live page had zero console errors/warnings and no failed resource responses; live state and the pool price were visible before wallet connection. Browser evidence is worker-observed, not independently certified.

## Interaction coverage

`web/tests/browser.mjs` injects an EIP-1193 wallet and protocol-shaped JSON-RPC responses. The production bundle contains no wallet/RPC mocks. Assertions cover:

- Disconnected state, chain switching, unknown-chain `4902` fallback, exact handoff add-chain parameters and loaded events/price.
- Invalid referral address, connected-address shortcut, clipboard copy and preservation of a static subpath in referral links.
- Invalid amount and slippage, focus on the invalid slippage field, quoted minimum output, quote expiration and stale-response rejection when the wallet changes mid-quote.
- Buy calldata decoding: configured router, native value, V4 command/actions, minimum output and exact referral ABI word.
- Sell sequence: exact REFR approval to configured Permit2, exact Permit2 authorization for the configured router, then swap. Separate buttons/signatures are asserted.
- Whole-balance claim and refreshed empty claim; wallet rejection, quote failure and simulation failure without a signing request; missing-wallet recovery.
- ABI tampering and missing deployed code fail closed; RPC failure disables actions and refresh recovers.
- Reflow at 1440, 800, 390 and 320 CSS pixels; axe WCAG 2 A/AA, 2.1 AA and 2.2 AA tags with no reported violations in those states; keyboard tab/focus; reduced-motion transition removal; 200% root text enlargement without horizontal document overflow.

`browser-check.json` records actual grouped results, screenshot paths and measured contrast. Screenshots `desktop.png`, `mobile.png`, `width-800.png`, `width-320.png` and `keyboard-focus.png` use deterministic mock data, clearly separated here from live evidence. `live-desktop.png` and `live-mobile.png` are real public-RPC/disconnected views. No screenshot is represented as a real completed wallet trade.

## Better Interface consolidated review

Applied the pinned workflow and core principles for all six domains while building; final review used both source and rendered production pages. Screenshots were opened and visually inspected, including the 320px layout and the live mobile page.

| Domain | Coverage | Evidence and limits |
| --- | --- | --- |
| Accessibility | Checked | Native landmarks/forms/buttons/details; explicit labels and dynamic statuses; minimum 44px buttons; focus ring and tab order; axe at four widths; reduced-motion and forced-colors source rules. Screen-reader, physical-device, forced-colors rendering and complete keyboard-only completion of every wallet flow were **not verified**. |
| Layout | Checked | Equal desktop columns become a single mobile column; full-address wrapping, stacked referral controls and event rows reviewed; no document overflow at 320/390/800/1440; 200% root text enlargement checked. Native browser zoom, RTL and localization stress tests were **not verified**. |
| Writing | Checked | Exact input, units, separate fee descriptions, explicit approval steps, empty state and recoverable errors reviewed. Router and scope conflicts are disclosed in documentation. |
| Typography | Checked | System font stack, serif accents, descending heading roles, 16px+ inputs, tabular numbers and real address/amount wrapping reviewed. No external font claims; typography across operating systems was **not verified**. |
| Colors | Checked | Semantic tokens; actual opaque rendered pairs measured: muted/page 5.47:1, text/feature 12.28:1, primary text/action 7.76:1. Axe scans passed. Disabled controls and every hover/focus adjacency were not individually contrast-measured. Dark theme is **not applicable**. |
| UI | Checked | Disabled, loading, selected, empty, error, confirmed and rejection states exercised; visible focus screenshot; hover and active CSS review; 120ms transitions absent under reduced motion. Slow-motion animation replay and physical touch behavior were **not verified**. Dialog/overlay focus trapping is **not applicable** (none exist). |

### Findings and corrections

| Severity / domain | Source location | Evidence, correction and recheck |
| --- | --- | --- |
| High / UI | `web/src/App.tsx:258` | An early gate required current-tick liquidity > 0. Live StateView returned zero while a valid buy quote and router simulation succeeded. Gate now requires an initialized pool; quote/simulation determine executable liquidity. Live read-only quote and buy simulation pass on all three RPCs. |
| Medium / accessibility, writing | `web/src/App.tsx:305` | Slippage errors initially shared the amount error, and moving focus inside the pending transaction wrapper caused a failing `toBeFocused` assertion. Errors now identify the correct field and validate/focus before setting busy. Regression test passes. |
| Medium / UI | `web/src/App.tsx:121` | Source review found wallet fallback available even on a wrong chain. The fallback is now constructed only on the configured chain. Switching and read-recovery browser tests pass; signature-time chain/account checks remain in `web/src/chain.ts:229`. |
| Low / UI | `web/index.html:6`, `web/src/favicon.svg` | Live browser showed a `/favicon.ico` 404. Added a local bundled SVG favicon. Final live reload has zero failed resources and console errors. |
| Medium / verification | `web/src/config.ts:148` | Protocol ABI loading initially lacked its own runtime integrity check. It now requires a declared asset entry and checks the downloaded bytes against its SHA-256; deployed contract ABIs retain canonical Keccak verification. Build/export checks and browser boot pass. |

No unresolved reproduced visual blocker remains in the tested states. This is not a claim of full WCAG conformance or a contract security audit.

## Live-chain evidence and limits

`rpc-check.json` records chain ID 11155111, nonempty code for the two deployed contracts and all six configured Uniswap addresses, expected hook manager, pool ID, StateView slot/liquidity, quoter output and successful `execute` simulation. The simulation uses `eth_call` with a hypothetical sender balance override and a canonical referral word. It changes no persistent chain state. Zero active liquidity at the current tick is visible and correctly described as “Quote to check range.”

Real wallet signatures, broadcast buys/sells, approvals, claim payouts, hardware wallets, production mobile wallet browsers, smart accounts, receipt replacement/reorg handling and long-lived rate limiting were not exercised. Local simulation success is not a guarantee that a future trade succeeds. The recent event window is 2,000 blocks; older activity requires the explorer. Runtime code checks prove presence and manager linkage, not full bytecode identity. The publication control plane's fixed CID/named-entrypoint, HTTP-budget and attestation checks have not run and are not prerequisites of this source delivery.

## Packaging and scope

Runtime assets and source/lockfile are complete. No package caches, dependency archives, `node_modules`, new submodules, protected contract files, root configuration or root ignore changes are included. `web/.gitignore` is the sole explicitly budgeted ignore file. Temporary browser-tool output is removed from the delivery tree. The complete candidate Git tree and conservative bundle-size evidence are recorded in `submission-check.json`. Packaging is checked with a temporary Git repository under `/tmp`; the protected repository metadata is not changed.

## Attribution

Design review guidance: [Jakub Krehel, Better Interface](https://github.com/jakubkrehel/skills/tree/267330e1adfc66a718fb65fa6918c1f06d0a689e/skills/better-interface), MIT, pinned commit `267330e1adfc66a718fb65fa6918c1f06d0a689e`. Documentation method: [Paul Bakaus, Impeccable](https://github.com/pbakaus/impeccable/blob/9d715cc4f5564a990ca8345abfdd5df6dc9b41c8/skill/reference/document.md), Apache-2.0, pinned commit `9d715cc4f5564a990ca8345abfdd5df6dc9b41c8`. Each reference retains its upstream license; this frontend does not relicense those guides or redistribute their full text.
