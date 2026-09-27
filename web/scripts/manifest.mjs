import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { keccak256, stringToHex, parseAbi, isAddress } from 'viem'
import { canonical } from '../src/integrity.ts'

process.chdir(fileURLToPath(new URL('..', import.meta.url)))
const read = async p => JSON.parse(await readFile(p, 'utf8'))
const handoff = await read('config/handoff.json')
const { network, walletAddChain } = await read('config/network.json')
const integrations = await read('config/integrations.json')
if (handoff.version !== 1 || handoff.chainId !== network.chainId || BigInt(walletAddChain.chainId) !== BigInt(handoff.chainId)) throw Error('Handoff/network chain mismatch')
if (!/^[a-f0-9]{40}$/.test(handoff.sourceCommit) || !/^[a-f0-9]{64}$/.test(handoff.attestationHash)) throw Error('Invalid source binding')
await mkdir('../dist/abi', { recursive: true })
await mkdir('../dist/licenses', { recursive: true })
await writeFile('../dist/licenses/DM-Sans-OFL.txt', await readFile('../docs/frontend/FONT-LICENSE.txt'))
const contracts = []
for (const c of handoff.contracts) {
  if (!/^[A-Za-z0-9_]+$/.test(c.name) || !isAddress(c.address)) throw Error('Invalid contract')
  const bytes = await readFile(`config/abi/${c.name}.json`)
  const abi = JSON.parse(bytes)
  const hash = keccak256(stringToHex(canonical(abi))).slice(2)
  if (!Array.isArray(abi) || hash !== c.abiHash) throw Error(`ABI hash mismatch: ${c.name}: ${hash}`)
  const abiPath = `abi/${c.name}.json`
  await writeFile(`../dist/${abiPath}`, bytes)
  contracts.push({ name: c.name, address: c.address, abiHash: c.abiHash, abiPath })
}
const structs = ['struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }']
const interfaces = {
  PoolSwapTest: parseAbi([...structs, 'struct SwapParams { bool zeroForOne; int256 amountSpecified; uint160 sqrtPriceLimitX96; }', 'struct TestSettings { bool takeClaims; bool settleUsingBurn; }', 'function swap(PoolKey key, SwapParams params, TestSettings testSettings, bytes hookData) payable returns (int256 delta)', 'function manager() view returns (address)']),
  StateView: parseAbi(['function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)', 'function getLiquidity(bytes32 poolId) view returns (uint128 liquidity)', 'function poolManager() view returns (address)']),
  V4Quoter: parseAbi([...structs, 'struct QuoteExactSingleParams { PoolKey poolKey; bool zeroForOne; uint128 exactAmount; bytes hookData; }', 'function quoteExactInputSingle(QuoteExactSingleParams params) returns (uint256 amountOut, uint256 gasEstimate)', 'function poolManager() view returns (address)']),
}
const interfacePaths = {}
for (const [name, abi] of Object.entries(interfaces)) {
  interfacePaths[name] = `abi/${name}.json`
  await writeFile(`../dist/abi/${name}.json`, JSON.stringify(abi, null, 2) + '\n')
}
async function inventory(dir, prefix = '') {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const path = prefix + entry.name
    if (entry.isDirectory()) files.push(...await inventory(`${dir}/${entry.name}`, `${path}/`))
    else if (path !== 'imd-deployment.json') {
      const bytes = await readFile(`${dir}/${entry.name}`)
      if (bytes.length > 8388608) throw Error(`Oversized asset ${path}`)
      files.push({ path, sha256: createHash('sha256').update(bytes).digest('hex') })
    }
  }
  return files.sort((a, b) => a.path.localeCompare(b.path))
}
const assets = await inventory('../dist')
if (assets.length > 128) throw Error('Too many assets')
const { version, launchId, chainId, sourceCommit, attestationHash } = handoff
const manifest = { version, launchId, chainId, sourceCommit, attestationHash, contracts, assets, network, walletAddChain, pool: handoff.manifest.pool, deploymentBlock: Math.min(...handoff.contracts.map(c => c.blockNumber)), integrations, interfacePaths }
await writeFile('../dist/imd-deployment.json', JSON.stringify(manifest, null, 2) + '\n')
console.log(`Verified ${contracts.length} pinned ABIs; inventoried ${assets.length} export assets.`)
