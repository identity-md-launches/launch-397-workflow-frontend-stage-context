import { formatUnits, parseUnits } from 'viem'

export const MIN_TIP = 3_000_000_000n
export function feeBpsFor(gasPrice: bigint, baseFee: bigint): number {
  if (baseFee === 0n || gasPrice <= baseFee) return 30
  const tip = gasPrice - baseFee
  return tip > baseFee && tip >= MIN_TIP ? 300 : 30
}
export function parseAmount(value: string, decimals: number): bigint {
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) || (value.split('.')[1]?.length ?? 0) > decimals) throw Error(`Enter a positive amount with at most ${decimals} decimal places.`)
  const amount = parseUnits(value, decimals)
  if (amount <= 0n || amount >= 2n ** 127n) throw Error('Enter a positive amount below the swap limit.')
  return amount
}
export function sqrt(value: bigint): bigint {
  if (value < 0n) throw Error('Negative square root')
  if (value < 2n) return value
  let x = value, y = (x + 1n) / 2n
  while (y < x) { x = y; y = (x + value / x) / 2n }
  return x
}
export function priceLimit(price: bigint, bps: number, buy: boolean): bigint {
  if (!Number.isInteger(bps) || bps < 1 || bps > 500) throw Error('Choose a price tolerance from 0.01% to 5%.')
  const limit = sqrt(price * price * BigInt(buy ? 10000 - bps : 10000 + bps) / 10000n)
  const min = 4295128740n, max = 1461446703485210103287273052203988822378723970341n
  if (limit <= min || limit >= max || limit === price) throw Error('Price limit is outside this pool’s usable range.')
  return limit
}
export function deltaAmounts(delta: bigint): [bigint, bigint] {
  return [BigInt.asIntN(128, delta >> 128n), BigInt.asIntN(128, delta)]
}
export function units(value: bigint | undefined, decimals = 18, precision = 6): string {
  if (value === undefined) return '—'
  const full = formatUnits(value, decimals)
  const [whole, frac = ''] = full.split('.')
  const part = frac.slice(0, precision).replace(/0+$/, '')
  if (value > 0n && whole === '0' && !part) return `<0.${'0'.repeat(precision - 1)}1`
  return `${Number(whole).toLocaleString('en-US', { maximumFractionDigits: 0 })}${part ? '.' + part : ''}`
}
export function short(value: string): string { return `${value.slice(0, 6)}…${value.slice(-4)}` }
export function errorText(error: unknown): string {
  const e = error as { shortMessage?: string; message?: string; code?: number; cause?: { code?: number } }
  if (e.code === 4001 || e.cause?.code === 4001 || /user rejected|user denied/i.test(e.message ?? '')) return 'Request declined in your wallet. You can try again.'
  return (e.shortMessage || e.message || 'Request failed. Check your connection and try again.').slice(0, 400)
}
