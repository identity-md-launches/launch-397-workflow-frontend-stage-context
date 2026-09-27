import { test } from 'node:test'
import assert from 'node:assert/strict'
import { feeBpsFor, parseAmount, priceLimit, deltaAmounts, sqrt } from '../src/math.ts'
import { canonical, safePath } from '../src/integrity.ts'

test('tier boundaries: equality, 1 wei either side, floor, zero base fee', () => {
  const g = 10n ** 9n
  assert.equal(feeBpsFor(0n, 0n), 30)
  assert.equal(feeBpsFor(50n * g, 0n), 30)
  assert.equal(feeBpsFor(3n * g, 3n * g), 30)
  assert.equal(feeBpsFor(8n * g - 1n, 4n * g), 30)
  assert.equal(feeBpsFor(8n * g, 4n * g), 30)
  assert.equal(feeBpsFor(8n * g + 1n, 4n * g), 300)
  assert.equal(feeBpsFor(4n * g - 1n, g), 30)
  assert.equal(feeBpsFor(4n * g, g), 300)
  assert.equal(feeBpsFor(4n * g + 1n, g), 300)
})
test('exact amount parser rejects silent rounding, negative, exponent, zero and oversized values', () => {
  assert.equal(parseAmount('0.000000000000000001', 18), 1n)
  assert.equal(parseAmount('12.123456', 6), 12123456n)
  for (const value of ['1e18', '-1', '0', ' 2', '01', '1.1234567', 'NaN']) assert.throws(() => parseAmount(value, 6))
  assert.throws(() => parseAmount((2n ** 127n).toString(), 0))
})
test('price tolerance is applied in squared price, in the correct swap direction', () => {
  const p = 1000n * 2n ** 96n
  for (const bps of [1, 50, 100, 500]) {
    const buy = priceLimit(p, bps, true), sell = priceLimit(p, bps, false)
    assert(buy < p); assert(sell > p)
    assert(buy * buy <= p * p * BigInt(10000 - bps) / 10000n)
    assert((buy + 1n) ** 2n > p * p * BigInt(10000 - bps) / 10000n)
  }
  assert.throws(() => priceLimit(p, 0, true))
  assert.throws(() => priceLimit(p, 501, false))
  assert.equal(sqrt(0n), 0n); assert.equal(sqrt(100n), 10n)
})
test('signed BalanceDelta decoding preserves both int128 currencies', () => {
  for (const [a,b] of [[-1000n, 996n], [997n, -1000n], [-1n, 1n]]) {
    const packed = BigInt.asIntN(256, (BigInt.asUintN(128,a) << 128n) | BigInt.asUintN(128,b))
    assert.deepEqual(deltaAmounts(packed), [a,b])
  }
})
test('canonical ABI JSON sorts object keys but preserves array order', () => {
  assert.equal(canonical([{ z: 1, a: { c: 2, b: 3 } }]), '[{"a":{"b":3,"c":2},"z":1}]')
  for (const path of ['../index.html','/abi/a.json','https://x/a','abi//a','abi/./a','abi/%2e%2e/a']) assert(!safePath(path))
  assert(safePath('abi/GASP.json'))
})
