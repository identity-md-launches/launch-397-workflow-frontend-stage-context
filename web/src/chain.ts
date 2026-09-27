import { getAbiItem, type Address, type Hash } from 'viem'
import type { Runtime, Client } from './config'

export type Snapshot = {
  block: bigint; baseFee: bigint; sqrtPrice: bigint; liquidity: bigint; accrued: readonly [bigint, bigint]
  decimals: number; symbol: string; balance: bigint; ethBalance: bigint; allowance: bigint; updatedAt: number
}
export async function readSnapshot(r: Runtime, client: Client, account?: Address): Promise<Snapshot> {
  const block = await client.getBlock()
  if (!block.number || block.baseFeePerGas === null) throw Error('RPC did not return an EIP-1559 block.')
  const read = (address: Address, abi: typeof r.abis.GASP, functionName: string, args: unknown[] = []) => client.readContract({ address, abi, functionName, args, blockNumber: block.number })
  const [slot, liquidity, accrued, decimals, symbol, balance, ethBalance, allowance] = await Promise.all([
    read(r.deployment.network.uniswapV4.stateView, r.abis.StateView, 'getSlot0', [r.poolId]) as Promise<readonly [bigint, number, number, number]>,
    read(r.deployment.network.uniswapV4.stateView, r.abis.StateView, 'getLiquidity', [r.poolId]) as Promise<bigint>,
    read(r.hook.address, r.abis.GasPriceFeeHook, 'accrued', [r.poolId]) as Promise<readonly [bigint, bigint]>,
    read(r.token.address, r.abis.GASP, 'decimals') as Promise<number>, read(r.token.address, r.abis.GASP, 'symbol') as Promise<string>,
    account ? read(r.token.address, r.abis.GASP, 'balanceOf', [account]) as Promise<bigint> : 0n,
    account ? client.getBalance({ address: account, blockNumber: block.number }) : 0n,
    account ? read(r.token.address, r.abis.GASP, 'allowance', [account, r.deployment.integrations.poolSwapTest]) as Promise<bigint> : 0n,
  ])
  if (slot[0] === 0n) throw Error('The attested pool is not initialized. Swaps are unavailable.')
  return { block: block.number, baseFee: block.baseFeePerGas, sqrtPrice: slot[0], liquidity, accrued, decimals, symbol, balance, ethBalance, allowance, updatedAt: Date.now() }
}

export type FeeRow = { id: string; block: bigint; hash: Hash; sender: Address; highTier: boolean; gasPrice: bigint; baseFee: bigint; currency: Address; fee: bigint }
export async function readHistory(r: Runtime, client: Client, to: bigint) {
  const start = to - 1999n > BigInt(r.deployment.deploymentBlock) ? to - 1999n : BigInt(r.deployment.deploymentBlock)
  const event = getAbiItem({ abi: r.abis.GasPriceFeeHook, name: 'FeeCharged' })
  if (event?.type !== 'event') throw Error('FeeCharged event missing from ABI.')
  const chunks = []
  for (let from = start; from <= to; from += 500n) {
    chunks.push(client.getLogs({ address: r.hook.address, event, args: { poolId: r.poolId }, fromBlock: from, toBlock: from + 499n > to ? to : from + 499n, strict: true }))
  }
  const logs = (await Promise.all(chunks)).flat()
  const rows = logs.map(log => ({ ...(log.args as unknown as Omit<FeeRow, 'id' | 'block' | 'hash'>), id: `${log.transactionHash}-${log.logIndex}`, block: log.blockNumber!, hash: log.transactionHash!, index: log.logIndex! }))
    .sort((a, b) => Number(b.block - a.block) || b.index - a.index).slice(0, 30)
  return { rows, start, end: to }
}
