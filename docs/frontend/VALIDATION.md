# Frontend validation and Better Interface review

Worker review date: 2026-09-27. **Implementation and validation complete; the requested in-place Git commit is blocked by the sandbox**, with the live-chain and assistive-technology limitations below. This is worker evidence, not independent certification, deployment approval or a publication check.

## Scope and decisions

One static page implements gas/base-fee monitoring, the tier preview, recent pool-specific `FeeCharged` events, accrued balances, permissionless donation, wallet connection, and exact-input swaps in both directions through the approved PoolSwapTest. Source and frontend configuration are under `web/`; the delivered static export is `dist/`; evidence and design documentation are under `docs/`. No backend, broadcast, deployment or publication was performed. Deployed Solidity, original `docs/abi/` files, `lib/`, root configuration and lockfiles are unchanged.

The root `DESIGN.md` criterion conflicts with the explicit overriding write budget. The implemented design is documented at **`docs/DESIGN.md`**. No root file was created to satisfy the lower-priority path requirement.

The workflow explicitly names PoolSwapTest, while the generic reference describes Universal Router. PoolSwapTest is used as requested, including direct exact-amount token approval to that router. The supplied network block is unchanged; StateView, quoter and PoolManager addresses come from it at runtime. The workflow's additional PoolSwapTest address lives in the manifest's `integrations` extension. Universal Router and Permit2 are not substituted for the assigned router.

## Commands and outcomes

All commands below ran successfully on the final source unless a limitation is stated:

| Check | Outcome |
| --- | --- |
| `npm --prefix web run typecheck` (also inside each build) | TypeScript passes |
| `npm --prefix web run build` | Production export built; manifest emitted after the export; both pinned canonical ABI hashes match |
| `npm --prefix web test` | 5 tests pass: fee boundaries, strict amount parsing, bigint price limits, signed delta decoding, canonical JSON/path safety |
| `PLAYWRIGHT_BROWSERS_PATH=./test/scratch/browsers npm --prefix web run test:browser` | 10 interaction/rendered scenarios pass against the actual production export at `/preview/` |
| `npm --prefix web run verify:export` | All 12 assets, both implementation ABIs, exact contract set, handoff identifiers, pool and unchanged network block verified; final export **633,396 bytes**, including manifest |
| `npm --prefix web ci --offline --cache ./test/scratch/npm-cache --no-audit --no-fund`, then build and export verification | Lockfile installation from the worker's populated cache succeeds; rebuilt manifest and every inventoried byte match the browser-tested export |
| `node web/scripts/live-check.mjs` | Read-only Sepolia chain/code/pool checks pass at block **11,791,838**; quote attempts have limitations below |

Machine evidence: [build-results.json](build-results.json), [browser-results.json](browser-results.json), [browser-styles.json](browser-styles.json), [contrast.json](contrast.json), [live-read-results.json](live-read-results.json). The test sources are included in `web/tests/`, and export/live-check scripts in `web/scripts/`. Build dependencies and browser binaries are not submitted. The static exporter does not require `.imd/reads/` or `test/scratch/` to exist.

The installed MCP browser tool returned `Transport closed` before navigation. Instead, local Playwright Chromium 140 ran in a bounded foreground process that owned and closed both preview server and browser. This is actual Chromium rendering and interaction, not a source-only substitute. Screenshots below use mocked chain and wallet data; they are **not** screenshots of real swaps or real trader activity.

## Interaction coverage

1. Relative subpath loading, public-state reads before connection, missing-wallet recovery, tier changes and high-tier history filtering.
2. Wrong-chain controls disabled; switch failure 4902; exact supplied `wallet_addEthereumChain` payload; second switch; quote invalidation on account change.
3. Buy rejects negative and unaffordable amounts; failed router simulation makes no signing request; successful fixture asserts destination, pool key, negative input, ETH value, chosen gas price, correct price-limit direction, hook data and both settlement flags. Acknowledgement is required.
4. Sell uses direct exact-amount ERC-20 approval to the assigned router; confirmed approval requires a fresh quote; rejected wallet transaction is recoverable; successful fixture validates token-input calldata and zero ETH value.
5. Donate simulates the exact pool key, targets the hook, waits for confirmation, refreshes accrual and disables a now-empty donation.
6. Empty events and zero in-range liquidity have explicit states; donation remains unavailable.
7. Quote expires after 45 seconds; signing is disabled; disconnect returns to connect-to-swap state.
8. Tampered implementation ABI bytes block initialization.
9. Missing required deployed code blocks transactions and reports a recoverable verification error.
10. Desktop/tablet/mobile rendering, page reflow, local font availability, keyboard skip/focus/activation, reduced motion and axe checks.

Mocks intercept every public RPC URL and the injected wallet. They validate actual serialized calls, but cannot prove real wallet compatibility, gas estimation or on-chain settlement. No private credentials are used. `eth_sendTransaction` in the browser suite is intercepted entirely inside the local fixture.

## Better Interface coverage

The pinned workflow and core principles for all six domains were read before implementation. The documentation method was read and applied to the final source. Coverage is consolidated rather than presented as six independent audits.

| Domain | Coverage | Evidence / limits |
| --- | --- | --- |
| Accessibility | Checked | Native buttons/anchors/inputs/disclosures; one main landmark and h1; skip link; visible field labels; focus outline; error associations and polite status; disabled prerequisites. Keyboard skip and activation exercised, focused input screenshot inspected. Axe WCAG 2 A/AA and 2.1 AA scans reported zero violations at five widths. No screen-reader session, complete keyboard-only transaction walk, or native-device test. |
| Layout | Checked | Viewed production screenshots at 1440×1080, 900×1000, 810×1000, 390×844 and 320×800. Measured document width at every size; no final page overflow. Activity region intentionally scrolls horizontally. Mobile DOM/visual reading order aligned. Browser-native 200% zoom, RTL mirror and pseudo-localization were not performed; the app is English-only. |
| Writing | Checked | Verb-first controls, consistent ETH/GASP units, separate pool and hook fees, router sender explained, donation has no caller reward, actionable missing-wallet/RPC/rejection messages. Router minimum-output/deadline limits are visible and acknowledged. No misleading history-as-wallet identity or simulation-as-guarantee wording. |
| Typography | Checked | Local DM Sans variable font loaded; fallback family recorded; numeric stability; tested heading wrapping and addresses at narrow widths. Inputs remain at least 16px. Dense metadata is 10–11px intentionally. Physical iOS input zoom and platform-specific font rendering are unverified. |
| Colors | Checked | Semantic tokens, non-color tier labels, computed backgrounds and contrast measurements for eight representative pairs. All measured pairs meet their listed 4.5:1 text or 3:1 boundary/focus threshold. One light theme only. Not a measurement of every transient/disabled/forced-color pair. |
| UI | Checked | Disconnected/connected, quote, rejection, successful fixture transaction, loading, empty, error, expired, high/standard, selected direction and focused field states exercised. Main button disabled/hover/press rules reviewed. Reduced-motion computed transition is 0s. No dialogs or staged animation; 10% animation-panel playback not performed. |

Screenshots inspected: [desktop](1440.png), [intermediate columns](900.png), [stacked tablet](810.png), [mobile](390.png), [320px reflow](320.png), [keyboard focus](keyboard-focus.png). These files contain the final layout. Automated checks supplement visual inspection; neither establishes full accessibility compliance.

## Findings and fixes

| Severity | Source | Finding and disposition | Recheck |
| --- | --- | --- | --- |
| High | `web/src/style.css:152` | At 390px, absolutely positioned hidden new-tab hints in the horizontally scrolling table expanded document width to 601px. Added a positioned containing block on `.table-wrap` so those hints remain within its scrolling bounds. | Rendered 390px and 320px screenshots inspected; document width assertions pass at all five widths. |
| Medium | `web/src/style.css:208` | The initial mobile grid reordered donation and swap visually while keeping another DOM/tab order. Removed the CSS row reordering and display-contents layout. | Stacked screenshots and source now follow sections 01–03 then swap in DOM order. |
| Medium | `web/src/App.tsx:94`, `:179`, `:184` | Initial form errors appeared only in a global alert, without tying the error to the amount/tolerance/hook-data input. Added inline error text, `aria-invalid`, `aria-describedby` and focus on invalid input. | Negative amount and insufficient balance scenarios pass; final axe scans pass. |
| Medium | `web/src/App.tsx:39`, `:58` | A refresh longer than the 20-second polling interval could be invalidated repeatedly by overlapping polls. Added an in-flight guard and a retained verified client; account changes cancel the old generation. | Source review confirms serialized polling; final connected/read/refresh/browser regression scenarios pass. A deliberately delayed multi-endpoint outage was not injected. |
| High, resolved during implementation | `web/src/App.tsx:121`, `:185` | PoolSwapTest cannot enforce a universal-router-style output minimum or deadline. Treating its tolerance as guaranteed output would misstate protection. Implemented square-root pool-price limits, explicit acknowledgement, 45-second local expiry and exact pre-signing simulation; copy states execution limits. | Buy/sell encoding, expiry, revert and acknowledgement scenarios pass. On-chain guarantee remains unavailable by design of the assigned contract. |
| Medium | `web/src/config.ts:16`, `:29` | Auxiliary interface files initially loaded without comparing their bytes to the inventory. All loaded ABI assets now have SHA-256 validation; implementation ABIs also retain canonical Keccak validation. | Tampered implementation asset scenario blocks startup; complete export inventory independently verifies. |

No unresolved in-scope visual or interaction defect was observed in the final checked states. This does not claim exhaustive coverage.

## Live-chain observations and limits

`live-read-results.json` pins the read-only smoke check to Sepolia block **11,791,838**, hash `0x24348f1c1562670ce601d46f943139d236070437aaf7ed620a8d4ce344a88979`. RPC chain ID was 11155111. GASP, GasPriceFeeHook, PoolManager, V4Quoter, StateView and PoolSwapTest all had nonempty code. The hook and router reported the supplied PoolManager. The token reported GASP and 18 decimals. The pool was initialized, with zero current in-range liquidity and zero accrued balances. This is a point-in-time observation, not the site's default data or a claim of permanent availability.

The unfunded live buy-quote attempt failed the RPC's simulation cost/balance check. The live sell quote reverted with selector `0x6190b2b0`; the worker did not establish a more specific cause. These attempts are recorded as errors, not successful live quotes. No live funded quote-to-swap, real approval, donation, receipt, wallet extension or chain-add prompt was executed. Transaction paths were validated only with mocked RPC and wallet behavior. The interface remains dependent on public RPC availability and actual pool liquidity. Browser-direct public-RPC CORS behavior was not separately certified; the live check used curl while browser scenarios used intercepts.

PoolSwapTest remains a test router without an on-chain minimum-output check or deadline. Quotes can diverge from inclusion-time base fees, state and wallet gas edits. No contract was added to alter that behavior. Publication, DNS/site naming, IPFS/CID checks, chain admission and immutable-host HTTP checks belong to the subsequent control plane and are not represented as worker successes.

## Export and submission integrity

The final export contains 12 declared files plus `imd-deployment.json`, 633,396 bytes total, safely below asset-count, per-file and HTTP-budget limits. Each ABI is a raw JSON array. Asset paths are relative and the manifest excludes itself. The two canonical ABI hashes match the supplied handoff, which was copied unchanged to `web/config/handoff.json`. The network and wallet-add blocks are copied unchanged from the supplied network input. The manifest and assets are regenerated together by every production build.

Only `web/`, `dist/` and `docs/` are submitted, including the explicitly allowed `web/.gitignore`. Dependencies and caches are ignored, with browser binaries and npm cache held under the disposable `test/scratch/`. No submodule is introduced. The sandbox mounts the assigned repository’s `.git/` read-only: `git add` failed while creating `.git/index.lock` with `Read-only file system`. The worker cannot create an in-place commit and cannot request escalation. A disposable clone under `test/scratch/` is used to commit the exact delivery snapshot and measure a complete Git bundle against the 8,388,608-byte limit. The delivered files remain in the assignment workspace for the publisher; the scratch clone/bundle is validation scaffolding, not an extra submitted packaging artifact.

## Interface sources

- The project's pinned `src/GasPriceFeeHook.sol`, `src/GASP.sol`, their raw `docs/abi/` exports, and both supplied protected Foundry test files were read to establish interface and behavior. No Solidity change or Foundry rerun is part of this frontend assignment.
- [PoolSwapTest at the dependency pin](https://github.com/Uniswap/v4-core/blob/a7cf038cd568801a79a9b4cf92cd5b52c95c8585/src/test/PoolSwapTest.sol) defines the settlement flags, negative exact-input parameter, hook-data forwarding and return delta.
- [IV4Quoter at the dependency pin](https://github.com/Uniswap/v4-periphery/blob/444c526b77d804590f0d7bc5a481af5a3277c952/src/interfaces/IV4Quoter.sol) defines `QuoteExactSingleParams` and the simulated exact-input quote return.
- [IStateView at the dependency pin](https://github.com/Uniswap/v4-periphery/blob/444c526b77d804590f0d7bc5a481af5a3277c952/src/interfaces/IStateView.sol) defines current price and liquidity reads.

Design-guide attribution and distinct licenses are recorded in [NOTICE.md](NOTICE.md). This report applies all six domains without treating repository content as authority to expand scope.
