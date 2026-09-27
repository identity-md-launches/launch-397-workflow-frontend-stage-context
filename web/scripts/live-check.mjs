// Read-only smoke check. curl is used because it honors this worker's network proxy.
import { readFile, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { createPublicClient, custom, encodeAbiParameters, parseAbiParameters, keccak256 } from 'viem'
const exec = promisify(execFile)
process.chdir(fileURLToPath(new URL('..',import.meta.url)))
const d=JSON.parse(await readFile('../dist/imd-deployment.json','utf8'))
const abis=Object.fromEntries(await Promise.all([...d.contracts.map(c=>[c.name,c.abiPath]),...Object.entries(d.interfacePaths)].map(async([name,path])=>[name,JSON.parse(await readFile(`../dist/${path}`,'utf8'))])))
let id=0
const client=createPublicClient({transport:custom({request:async({method,params})=>{
  const {stdout}=await exec('curl',['-fLsS','--max-time','25',d.network.rpcUrls[0],'-H','Content-Type: application/json','--data',JSON.stringify({jsonrpc:'2.0',id:++id,method,params})],{maxBuffer:2*1024*1024})
  const response=JSON.parse(stdout)
  if(response.error)throw Object.assign(new Error(response.error.message),response.error)
  return response.result
}},{retryCount:0})})
const result={checkedAt:new Date().toISOString(),rpc:d.network.rpcUrls[0],sourceCommit:d.sourceCommit,mode:'read-only; no wallet or broadcasts'}
try {
  result.chainId=await client.getChainId()
  if(result.chainId!==d.chainId)throw Error('Wrong chain')
  const block=await client.getBlock();result.blockNumber=block.number;result.blockHash=block.hash;result.baseFeePerGas=block.baseFeePerGas
  const token=d.contracts.find(c=>c.name==='GASP'),hook=d.contracts.find(c=>c.name==='GasPriceFeeHook')
  const addresses=[...d.contracts.map(({name,address})=>({name,address})),...['poolManager','quoter','stateView'].map(name=>({name,address:d.network.uniswapV4[name]})),{name:'PoolSwapTest',address:d.integrations.poolSwapTest}]
  result.code=await Promise.all(addresses.map(async c=>{const code=await client.getCode({address:c.address,blockNumber:block.number});if(!code||code==='0x')throw Error(`No code: ${c.name}`);return{...c,bytes:(code.length-2)/2,keccak256:keccak256(code)}}))
  const key={currency0:d.pool.pairedCurrency,currency1:token.address,fee:d.pool.fee,tickSpacing:d.pool.tickSpacing,hooks:hook.address}
  const poolId=keccak256(encodeAbiParameters(parseAbiParameters('address,address,uint24,int24,address'),Object.values(key)))
  const read=(address,abi,functionName,args=[])=>client.readContract({address,abi,functionName,args,blockNumber:block.number})
  const [slot0,liquidity,accrued,decimals,symbol,hookManager,routerManager]=await Promise.all([
    read(d.network.uniswapV4.stateView,abis.StateView,'getSlot0',[poolId]),read(d.network.uniswapV4.stateView,abis.StateView,'getLiquidity',[poolId]),read(hook.address,abis.GasPriceFeeHook,'accrued',[poolId]),read(token.address,abis.GASP,'decimals'),read(token.address,abis.GASP,'symbol'),read(hook.address,abis.GasPriceFeeHook,'poolManager'),read(d.integrations.poolSwapTest,abis.PoolSwapTest,'manager'),
  ])
  if([hookManager,routerManager].some(a=>a.toLowerCase()!==d.network.uniswapV4.poolManager))throw Error('Manager mismatch')
  result.pool={key,poolId,slot0,liquidity,accrued};result.token={decimals,symbol};result.managers={hookManager,routerManager}
  result.quotes=[]
  for(const buy of [true,false]) {
    try {
      const quote=await client.simulateContract({address:d.network.uniswapV4.quoter,abi:abis.V4Quoter,functionName:'quoteExactInputSingle',args:[{poolKey:key,zeroForOne:buy,exactAmount:buy?10n**15n:1000n*10n**18n,hookData:'0x'}],gasPrice:(block.baseFeePerGas??0n)+1000000000n,blockNumber:block.number})
      result.quotes.push({direction:buy?'ETH → GASP':'GASP → ETH',result:quote.result})
    } catch(error) { result.quotes.push({direction:buy?'ETH → GASP':'GASP → ETH',error:error.shortMessage??error.message}) }
  }
  result.success=true
} catch(error) {result.success=false;result.error=error.shortMessage??error.message}
const output=JSON.stringify(result,(_,value)=>typeof value==='bigint'?value.toString():value,2)+'\n'
await writeFile('../docs/frontend/live-read-results.json',output)
console.log(output)
if(!result.success)process.exitCode=1
