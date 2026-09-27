# Gas Tax frontend

A single-page Sepolia lab for the deployed GASP token and GasPriceFeeHook. React, TypeScript, Vite, wagmi core (injected wallets), and viem. No backend, API key, wallet key, WalletConnect project ID, or live transaction is required to build or test it.

The delivered `../dist/` is the deliverable for static hosting. Publish its contents, including `imd-deployment.json` and `abi/`, together. Vite uses `base: './'`; the browser tests serve the actual export under `/preview/`. The application uses in-page anchors and needs no server rewrites. All fonts, scripts, and styles are local. Only public RPC reads and visitor-controlled wallet requests use the network at runtime.

## Install, build, preview

Node 22.23.3 and npm 10.9.9 were used. From this directory:

```sh
npm ci --cache ../test/scratch/npm-cache --no-audit --no-fund
npm run build
npm run preview -- --host 127.0.0.1
```

Open the URL printed by Vite. `npm run dev` builds the runtime configuration first, then starts Vite with a small development-only middleware that serves the manifest and ABI files from `../dist/`. There is no production server component. A build does not fetch dependencies or fonts; with a populated npm cache, installation also works with `npm ci --offline --cache ../test/scratch/npm-cache --no-audit --no-fund`. No npm cache, browser binary, `node_modules`, archive, or registry mirror is submitted.

## Deployment configuration and ABI binding

`dist/imd-deployment.json` is the application's sole runtime configuration. `src/config.ts` fetches it relative to the hosting subpath, loads every referenced ABI JSON, checks each ABI asset's SHA-256, and checks the implementation ABIs' canonical Keccak hashes. It derives the chain, RPC clients, wallet configuration, pool key and pool ID from that manifest. There is no independent production address map in TypeScript.

Build inputs in `config/`:

- `handoff.json`: supplied deployment handoff, unchanged, including the exact contract set, deployment blocks, pool description, source commit and attestation.
- `network.json`: supplied network and exact `wallet_addEthereumChain` parameters, unchanged.
- `abi/GASP.json` and `abi/GasPriceFeeHook.json`: raw implementation ABI arrays copied with `git show` from source commit `c961c3ddcba49b506d15a815128a736a5a60690c`, identical to its `docs/abi/` exports.
- `integrations.json`: the PoolSwapTest address explicitly approved in the workflow. The vetted network block has no PoolSwapTest field, so this workflow-specific integration is a separate manifest extension. The supplied network block is preserved intact.

`scripts/manifest.mjs` runs after Vite. It verifies the chain binding and both canonical ABI hashes, exports the implementation and minimal auxiliary ABIs, inventories every exported file except the manifest, hashes final bytes, and writes the manifest. The `contracts` array contains exactly the handoff's two contracts; auxiliary Uniswap interfaces do not expand that attested set. Extra manifest fields carry the pool, deployment block, wallet-add parameters, integration and interface paths. Rebuild after any export change. `npm run verify:export` independently checks the manifest, all files, hashes, paths, limits and handoff bindings.

The auxiliary interfaces follow `lib/v4-core/src/test/PoolSwapTest.sol` at the deployed source commit and Uniswap's pinned v4-periphery interfaces at `444c526b77d804590f0d7bc5a481af5a3277c952`. See [interface sources](../docs/frontend/VALIDATION.md#interface-sources).

## Behavior

Public RPC reads work before wallet connection and refresh every 20 seconds. The app verifies the RPC chain, nonempty code at six required addresses, and the hook/router PoolManager bindings before enabling transactions. Endpoints are tried in the supplied order. A read failure or a snapshot older than 60 seconds disables actions. Polling does not overlap an in-progress refresh. State reads use one block number; event history queries the latest 2,000 blocks, bounded by deployment, in four chunks of at most 500 blocks, displaying the newest 30 events for this pool only. A failed history request is reported separately from usable current state.

Connect a browser-injected Ethereum wallet. The page shows a connected address and explicit disconnect control. On a wrong chain, use **Switch to Sepolia**. Unknown-chain error 4902 (including a nested code) or an unknown-chain message triggers the exact supplied `wallet_addEthereumChain` request, followed by another switch. No WalletConnect credentials were supplied, so WalletConnect is not included.

The page exposes:

- Current base fee, 2× threshold, the 3 gwei minimum tip, and a chosen-gas-price fee preview. High tier requires gas price strictly greater than 2× base fee **and** tip at least 3 gwei. Zero base fee is standard tier. The gas price field supplies the legacy `gasPrice` on swaps; a wallet can still edit it and the inclusion block can change the tier.
- Exact-input buys and sells. Currency0 is native ETH, currency1 is GASP, with the pool fee and tick spacing from the handoff. `amountSpecified` is negative. Token decimals and symbol are queried on-chain.
- V4Quoter quotes through `simulateContract` only. StateView supplies the current pool price. Both addresses come from `network.uniswapV4` in the runtime manifest.
- Exact-amount ERC-20 approval to **PoolSwapTest** for sells, shown as its own transaction. Buys send ETH and need no approval. This is the workflow's explicit router, so neither Universal Router nor Permit2 is invoked; their supplied addresses remain unchanged in the manifest. Universal Router guidance in the background reference does not override this assignment.
- A pool-price tolerance of 0.01–5%, translated to `sqrtPriceLimitX96` with bigint square-root arithmetic. Both directions forward the displayed `hookData`, with `takeClaims=false` and `settleUsingBurn=false`.
- A mandatory acknowledgement of PoolSwapTest's limitations before swapping. The router has **no on-chain minimum-output check or deadline**. The price limit bounds the pool price, not the received amount after fees; a swap may partially fill. The UI invalidates quotes after 45 seconds and re-simulates exact router calldata before signing. It rejects simulations below the displayed quote's tolerance-adjusted output or outside the requested input. This is only a pre-signing check, not an execution guarantee. No wrapper contract was deployed to change this interface.
- Permissionless `donateFees(poolKey)`, simulated before signing. This donates all accrued balances to current in-range LPs. The caller pays gas and receives no caller reward. Zero accrued fees or zero in-range liquidity disable donation.
- Explicit loading, rejection, revert, pending and confirmed states, with explorer links to submitted transactions. Account, chain, direction and form changes invalidate quotes. ABI integrity failures block initialization.

The fee preview is derived from the pinned implementation, not a promised result. `FeeCharged.sender` is the router, not an authenticated trader. `hookData` is ignored and unauthenticated. Private bundles with low tips and direct validator payments can avoid the high tier. RPC simulations with a zero base fee use the standard tier.

## Validation

```sh
npm run typecheck
npm test
PLAYWRIGHT_BROWSERS_PATH=../test/scratch/browsers node node_modules/playwright/cli.js install chromium
PLAYWRIGHT_BROWSERS_PATH=../test/scratch/browsers npm run test:browser
npm run verify:export
node scripts/live-check.mjs
```

The browser test creates and closes its own foreground preview server, serves the production export at a subpath, and mocks wallet/RPC behavior. It never broadcasts. It writes screenshots, computed styles, contrast measurements and results into `../docs/frontend/`. The final command is a separate read-only public-RPC smoke check using `curl`; its results record the observed block. It does not certify swaps or contract security.

See [validation and limitations](../docs/frontend/VALIDATION.md), [implemented design](../docs/DESIGN.md), and [browser evidence](../docs/frontend/browser-results.json). The assignment forbids root-file edits, so the requested design document is delivered at `docs/DESIGN.md` rather than repository-root `DESIGN.md`. Contracts, root configuration, original ABI exports and dependencies under `lib/` are preserved.

The assignment sandbox makes the original repository’s `.git/` read-only. In-place staging/commit was unavailable; the publisher must include the delivered source, lockfile, export and evidence in its submission commit. A disposable Git snapshot is used only to validate complete bundle size.
