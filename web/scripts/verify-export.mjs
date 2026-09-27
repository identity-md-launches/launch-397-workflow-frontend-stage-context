import { readFile, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { keccak256, stringToHex } from 'viem'
import { canonical, safePath } from '../src/integrity.ts'
process.chdir(fileURLToPath(new URL('..', import.meta.url)))
const json = async path => JSON.parse(await readFile(path, 'utf8'))
const d = await json('../dist/imd-deployment.json'), h = await json('config/handoff.json'), n = await json('config/network.json')
for (const key of ['version','launchId','chainId','sourceCommit','attestationHash']) assert.deepEqual(d[key], h[key])
assert.deepEqual(d.network, n.network); assert.deepEqual(d.walletAddChain, n.walletAddChain)
assert.deepEqual(d.contracts.map(({abiPath, ...rest}) => rest), h.contracts.map(({name,address,abiHash}) => ({name,address,abiHash})))
assert.deepEqual(d.pool,h.manifest.pool)
assert(d.assets.length <= 128)
assert.equal(new Set(d.assets.map(a => a.path)).size, d.assets.length)
let size = 0
for (const asset of d.assets) {
  assert(safePath(asset.path)); assert.notEqual(asset.path,'imd-deployment.json')
  const bytes = await readFile(`../dist/${asset.path}`); size += bytes.length
  assert(bytes.length <= 8388608)
  assert.equal(createHash('sha256').update(bytes).digest('hex'),asset.sha256)
}
const files = (await readdir('../dist',{recursive:true,withFileTypes:true})).filter(e=>e.isFile()).map(e => `${e.parentPath}/${e.name}`.replace('../dist/','')).filter(p=>p !== 'imd-deployment.json').sort()
assert.deepEqual(d.assets.map(a => a.path).sort(),files)
for (const c of d.contracts) assert.equal(keccak256(stringToHex(canonical(await json(`../dist/${c.abiPath}`)))).slice(2), c.abiHash)
assert(size < 32 * 1024 * 1024)
console.log(JSON.stringify({verified:true,contracts:d.contracts.length,assets:d.assets.length,exportBytes:size + (await readFile('../dist/imd-deployment.json')).length},null,2))
