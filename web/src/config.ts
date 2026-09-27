import { createPublicClient, defineChain, http, keccak256, sha256, stringToHex, encodeAbiParameters, parseAbiParameters, isAddress, type Abi, type Address } from 'viem'
import { createConfig, injected } from '@wagmi/core'
import { canonical, safePath } from './integrity'

export type Deployment = {
  version: number; launchId: string; chainId: number; sourceCommit: string; attestationHash: string
  contracts: { name: string; address: Address; abiHash: string; abiPath: string }[]
  assets: { path: string; sha256: string }[]
  network: { chainId: number; name: string; testnet: boolean; rpcUrls: string[]; explorer: string; nativeCurrency: { name: string; symbol: string; decimals: number }; faucets: string[]; uniswapV4: { poolManager: Address; universalRouter: Address; quoter: Address; stateView: Address; positionManager: Address; permit2: Address } }
  walletAddChain: { chainId: `0x${string}`; chainName: string; rpcUrls: string[]; nativeCurrency: { name: string; symbol: string; decimals: number }; blockExplorerUrls: string[] }
  pool: { pairedCurrency: Address; fee: number; tickSpacing: number }
  deploymentBlock: number; integrations: { poolSwapTest: Address }; interfacePaths: Record<string, string>
}

async function json(path: string, expectedSha?: string) {
  if (!safePath(path)) throw Error('Unsafe configuration asset path.')
  const response = await fetch(new URL(path, new URL(import.meta.env.BASE_URL, document.baseURI)), { cache: 'no-cache' })
  if (!response.ok) throw Error(`Unable to load ${path}. Reload to retry.`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (expectedSha && sha256(bytes).slice(2) !== expectedSha) throw Error(`Asset verification failed for ${path}. Reload the deployment.`)
  return JSON.parse(new TextDecoder().decode(bytes))
}

export async function loadRuntime() {
  const deployment = await json('imd-deployment.json') as Deployment
  const d = deployment, n = d.network
  if (d.version !== 1 || d.chainId !== n.chainId || BigInt(d.walletAddChain.chainId) !== BigInt(d.chainId) || !n.testnet || d.contracts.length !== 2) throw Error('Deployment configuration is inconsistent.')
  const abis: Record<string, Abi> = {}
  const assetHash = (path: string) => {
    const hash = d.assets.find(a => a.path === path)?.sha256
    if (!hash || !/^[a-f0-9]{64}$/.test(hash)) throw Error(`ABI asset is missing from the inventory: ${path}`)
    return hash
  }
  for (const c of d.contracts) {
    if (!isAddress(c.address)) throw Error('Invalid deployment address.')
    const abi = await json(c.abiPath, assetHash(c.abiPath))
    if (!Array.isArray(abi) || keccak256(stringToHex(canonical(abi))).slice(2) !== c.abiHash) throw Error(`ABI verification failed for ${c.name}. Transactions are disabled.`)
    abis[c.name] = abi
  }
  for (const [name, path] of Object.entries(d.interfacePaths)) {
    // The exported asset inventory binds auxiliary interfaces to the same manifest.
    const abi = await json(path, assetHash(path))
    if (!Array.isArray(abi)) throw Error(`Invalid interface: ${name}`)
    abis[name] = abi
  }
  const token = d.contracts.find(c => c.name === 'GASP')!
  const hook = d.contracts.find(c => c.name === 'GasPriceFeeHook')!
  if (!token || !hook || !isAddress(d.integrations.poolSwapTest)) throw Error('Required contracts are missing.')
  const chain = defineChain({ id: d.chainId, name: n.name, nativeCurrency: n.nativeCurrency, rpcUrls: { default: { http: n.rpcUrls } }, blockExplorers: { default: { name: 'Explorer', url: n.explorer } }, testnet: n.testnet })
  const wagmi = createConfig({ chains: [chain], connectors: [injected()], transports: { [chain.id]: http(n.rpcUrls[0]) }, storage: null, multiInjectedProviderDiscovery: true })
  const key = { currency0: d.pool.pairedCurrency, currency1: token.address, fee: d.pool.fee, tickSpacing: d.pool.tickSpacing, hooks: hook.address }
  if (BigInt(key.currency0) >= BigInt(key.currency1)) [key.currency0, key.currency1] = [key.currency1, key.currency0]
  const poolId = keccak256(encodeAbiParameters(parseAbiParameters('address, address, uint24, int24, address'), [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks]))
  return { deployment, abis, token, hook, chain, wagmi, key, poolId }
}
export type Runtime = Awaited<ReturnType<typeof loadRuntime>>
export function rpcClient(runtime: Runtime, url: string) { return createPublicClient({ chain: runtime.chain, transport: http(url, { timeout: 9000, retryCount: 1, batch: false }) }) }
export type Client = ReturnType<typeof rpcClient>

export async function verifiedClient(r: Runtime): Promise<Client> {
  const addresses = [r.token.address, r.hook.address, r.deployment.network.uniswapV4.poolManager, r.deployment.network.uniswapV4.quoter, r.deployment.network.uniswapV4.stateView, r.deployment.integrations.poolSwapTest]
  const errors: string[] = []
  for (const url of r.deployment.network.rpcUrls) {
    try {
      const client = rpcClient(r, url)
      if (await client.getChainId() !== r.deployment.chainId) throw Error('RPC returned the wrong chain.')
      const code = await Promise.all(addresses.map(address => client.getCode({ address })))
      if (code.some(c => !c || c === '0x')) throw Error('A required contract has no deployed code.')
      const manager = await client.readContract({ address: r.hook.address, abi: r.abis.GasPriceFeeHook, functionName: 'poolManager' }) as Address
      const routerManager = await client.readContract({ address: r.deployment.integrations.poolSwapTest, abi: r.abis.PoolSwapTest, functionName: 'manager' }) as Address
      if ([manager, routerManager].some(a => a.toLowerCase() !== r.deployment.network.uniswapV4.poolManager.toLowerCase())) throw Error('Contract PoolManager mismatch.')
      return client
    } catch (error) { errors.push(error instanceof Error ? error.message : String(error)) }
  }
  throw Error(`Unable to verify the deployment on the supplied RPCs. Retry when the network is available. ${errors.at(-1)?.slice(0, 120)}`)
}
