import { chromium, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { createServer } from 'node:http'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { decodeFunctionData, encodeFunctionResult, encodeEventTopics, encodeAbiParameters, encodeErrorResult, parseAbi, keccak256, parseAbiParameters, getAddress } from 'viem'

const web = fileURLToPath(new URL('..', import.meta.url)), root = resolve(web, '..'), dist = resolve(root, 'dist')
const d = JSON.parse(await readFile(resolve(dist, 'imd-deployment.json'), 'utf8'))
const abis = Object.fromEntries(await Promise.all([...d.contracts.map(c => [c.name,c.abiPath]), ...Object.entries(d.interfacePaths)].map(async ([name,path]) => [name,JSON.parse(await readFile(resolve(dist,path),'utf8'))])))
const address = '0x1111111111111111111111111111111111111111'
const alternate = '0x2222222222222222222222222222222222222222'
const hook = d.contracts.find(c=>c.name === 'GasPriceFeeHook').address
const token = d.contracts.find(c=>c.name === 'GASP').address
const blockNumber = 12000000n, blockHash = `0x${'ab'.repeat(32)}`, txHash = `0x${'cd'.repeat(32)}`
const hex = n => `0x${BigInt(n).toString(16)}`
const poolId = keccak256(encodeAbiParameters(parseAbiParameters('address,address,uint24,int24,address'),[d.pool.pairedCurrency,token,d.pool.fee,d.pool.tickSpacing,hook]))
const key = { currency0:d.pool.pairedCurrency,currency1:getAddress(token),fee:d.pool.fee,tickSpacing:d.pool.tickSpacing,hooks:getAddress(hook) }
const block = { number:hex(blockNumber),hash:blockHash,parentHash:blockHash,nonce:'0x0000000000000000',sha3Uncles:blockHash,logsBloom:`0x${'00'.repeat(256)}`,transactionsRoot:blockHash,stateRoot:blockHash,receiptsRoot:blockHash,miner:address,difficulty:'0x0',totalDifficulty:'0x0',extraData:'0x',size:'0x100',gasLimit:'0x1c9c380',gasUsed:'0x100000',timestamp:hex(Math.floor(Date.now()/1000)),transactions:[],uncles:[],baseFeePerGas:hex(1000000000n),mixHash:blockHash }
const results = [], errors = []
const server = createServer(async (req,res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/preview\//,'') || 'index.html'
  if (!req.url.startsWith('/preview/') || path.includes('..')) { res.writeHead(404).end(); return }
  try {
    const body = await readFile(resolve(dist,path))
    const type = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.woff2':'font/woff2' }[extname(path)] || 'application/octet-stream'
    res.writeHead(200,{'Content-Type':type});res.end(body)
  } catch { res.writeHead(404).end() }
})
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve))
const url = `http://127.0.0.1:${server.address().port}/preview/`
const browser = await chromium.launch({headless:true})
await mkdir(resolve(root,'docs/frontend'),{recursive:true})

function state(overrides={}) { return { allowance:0n,accrued:[250000000000000n,125000000000000000000n],liquidity:1000000000000000000n,txs:[],calls:[],empty:false,revertSwap:false,missingCode:false,...overrides } }
function rpc(s, request) {
  const { method, params=[] } = request; s.calls.push({method,params})
  switch(method) {
    case 'eth_chainId': return hex(d.chainId)
    case 'eth_getCode': return s.missingCode ? '0x' : '0x60006000'
    case 'eth_blockNumber': return hex(blockNumber)
    case 'eth_getBlockByNumber': return block
    case 'eth_getBalance': return hex(10n**19n)
    case 'eth_estimateGas': return '0x50000'
    case 'eth_gasPrice': return hex(2000000000n)
    case 'eth_getTransactionCount': return '0x1'
    case 'eth_getTransactionReceipt': return { transactionHash:txHash,transactionIndex:'0x0',blockHash,blockNumber:hex(blockNumber),from:address,to:s.txs.at(-1)?.to ?? hook,cumulativeGasUsed:'0x10000',gasUsed:'0x10000',contractAddress:null,logs:[],logsBloom:`0x${'00'.repeat(256)}`,status:'0x1',effectiveGasPrice:hex(2000000000n),type:'0x0' }
    case 'eth_getLogs': {
      if(s.empty || BigInt(params[0].fromBlock)>blockNumber || BigInt(params[0].toBlock)<blockNumber) return []
      const event = abis.GasPriceFeeHook.find(a=>a.name === 'FeeCharged')
      return [false,true].map((highTier,i)=>({address:hook,blockHash,blockNumber:hex(blockNumber),transactionHash:i?`0x${'ef'.repeat(32)}`:txHash,transactionIndex:hex(i),logIndex:hex(i),removed:false,topics:encodeEventTopics({abi:[event],eventName:'FeeCharged',args:{poolId}}),data:encodeAbiParameters(event.inputs.filter(a=>!a.indexed),[d.integrations.poolSwapTest,highTier,highTier?5000000000n:2000000000n,1000000000n,token,highTier?3000000000000000000n:300000000000000000n])}))
    }
    case 'eth_call': {
      const tx=params[0], to=tx.to.toLowerCase()
      const name = to === token.toLowerCase() ? 'GASP' : to === hook.toLowerCase() ? 'GasPriceFeeHook' : to === d.network.uniswapV4.stateView ? 'StateView' : to === d.network.uniswapV4.quoter ? 'V4Quoter' : 'PoolSwapTest'
      const abi=abis[name], decoded=decodeFunctionData({abi,data:tx.data}), fn=decoded.functionName
      let result
      if(fn === 'manager' || fn === 'poolManager') result=d.network.uniswapV4.poolManager
      else if(fn === 'getSlot0') result=[1000n*2n**96n,138162,0,3000]
      else if(fn === 'getLiquidity') result=s.liquidity
      else if(fn === 'accrued') result=s.accrued
      else if(fn === 'decimals') result=18
      else if(fn === 'symbol') result='GASP'
      else if(fn === 'balanceOf') result=500000n*10n**18n
      else if(fn === 'allowance') result=s.allowance
      else if(fn === 'approve') result=true
      else if(fn === 'donateFees') { if(!s.liquidity) throw Error('NoLiquidity');result=undefined }
      else if(fn === 'quoteExactInputSingle') result=[decoded.args[0].zeroForOne ? 997n*10n**18n : 997n*10n**12n,160000n]
      else if(fn === 'swap') {
        if(s.revertSwap) throw Error('Price limit simulation failed')
        const p=decoded.args[1], input=p.amountSpecified
        const [a,b]=p.zeroForOne?[input,997n*10n**18n]:[997n*10n**12n,input]
        result=BigInt.asIntN(256,(BigInt.asUintN(128,a)<<128n)|BigInt.asUintN(128,b))
      } else throw Error(`Unhandled call ${fn}`)
      return encodeFunctionResult({abi,functionName:fn,result})
    }
    case 'eth_sendTransaction': {
      const tx=params[0];s.txs.push(tx)
      if(tx.to.toLowerCase() === token.toLowerCase()) s.allowance=decodeFunctionData({abi:abis.GASP,data:tx.data}).args[1]
      if(tx.to.toLowerCase() === hook.toLowerCase()) s.accrued=[0n,0n]
      return txHash
    }
    default: throw Error(`Unhandled RPC ${method}`)
  }
}
async function setup({wallet=true,wrong=false,reject=false,tamper=false,...overrides}={}) {
  const s=state(overrides),context=await browser.newContext({viewport:{width:1440,height:1000}})
  await context.route('https://**',async route=>{
    try { const body=route.request().postDataJSON();const result=rpc(s,body);await route.fulfill({json:{jsonrpc:'2.0',id:body.id,result}}) }
    catch(error) { const body=route.request().postDataJSON();await route.fulfill({json:{jsonrpc:'2.0',id:body?.id,error:{code:3,message:error.message,data:encodeErrorResult({abi:parseAbi(['error Error(string)']),errorName:'Error',args:[error.message]})}}}) }
  })
  if(tamper) await context.route('**/abi/GASP.json', route=>route.fulfill({json:[]}))
  if(wallet) {
    await context.exposeBinding('__rpc',(_source,request)=>rpc(s,request))
    await context.addInitScript(({address,chain,wrong,reject})=>{
      const listeners={}
      const w=window.__wallet={chain:wrong?'0x1':chain,accounts:[address],added:[],switched:[],reject,unknown:wrong}
      w.emit=(event,data)=>{if(event === 'chainChanged')w.chain=data;if(event === 'accountsChanged')w.accounts=data;for(const callback of listeners[event]||[])callback(data)}
      window.ethereum={isMetaMask:true,on:(event,fn)=>{(listeners[event]??=[]).push(fn)},removeListener:(event,fn)=>{listeners[event]=(listeners[event]||[]).filter(x=>x!==fn)},request:async({method,params})=>{
        if(method === 'eth_requestAccounts') {if(w.reject)throw {code:4001,message:'User rejected request'};return w.accounts}
        if(method === 'eth_accounts')return w.accounts
        if(method === 'eth_chainId')return w.chain
        if(method === 'wallet_requestPermissions')return [{parentCapability:'eth_accounts'}]
        if(method === 'wallet_revokePermissions')return null
        if(method === 'wallet_switchEthereumChain'){w.switched.push(params[0]);if(w.unknown)throw{code:4902,message:'Unknown chain'};w.emit('chainChanged',params[0].chainId);return null}
        if(method === 'wallet_addEthereumChain'){w.added.push(params[0]);w.unknown=false;return null}
        if(method === 'eth_sendTransaction' && w.reject)throw{code:4001,message:'User rejected transaction'}
        return window.__rpc({method,params})
      }}
    },{address,chain:hex(d.chainId),wrong,reject})
  }
  const page=await context.newPage()
  page.on('pageerror',e=>errors.push(e.message))
  page.on('console',m=>{if(m.type()==='error') errors.push(m.text())})
  await page.goto(url)
  return {s,context,page}
}
async function live(page) { await expect(page.getByText('Live pool data',{exact:true})).toBeVisible() }
async function connect(page) { await page.getByRole('button',{name:'Connect wallet',exact:true}).click();await expect(page.getByRole('button',{name:/Disconnect/})).toBeVisible() }
async function quote(page) { await page.getByRole('button',{name:/^(Get quote|Refresh quote)/}).click();await expect(page.getByText('Quote ready.',{exact:false})).toBeVisible() }
async function record(name,fn) { await fn();results.push(name);console.log(`PASS ${name}`) }
try {
  await record('Subpath export, missing wallet, live reads, fee tiers and history filter',async()=>{
    const {page,context}=await setup({wallet:false});await live(page)
    await expect(page.getByRole('button',{name:'Donate fees'})).toBeDisabled()
    await page.getByRole('button',{name:'Connect wallet to swap'}).click();await expect(page.getByRole('alert')).toContainText('No browser wallet')
    await page.getByLabel('Your transaction gas price').fill('5');await expect(page.getByText('↑ High tier',{exact:true})).toBeVisible()
    await page.getByLabel('Your transaction gas price').fill('2');await expect(page.getByText('↘ Standard tier')).toBeVisible()
    assert.equal(await page.locator('tbody tr').count(),2)
    await page.getByLabel('High tier only').check();assert.equal(await page.locator('tbody tr').count(),1)
    await context.close()
  })
  await record('Unknown chain: switch → exact addEthereumChain → switch; account change invalidation',async()=>{
    const {page,context}=await setup({wrong:true});await live(page);await connect(page)
    await expect(page.getByRole('button',{name:'Get quote',exact:true})).toBeDisabled()
    await page.getByRole('button',{name:'Switch to Sepolia'}).click()
    await expect(page.getByRole('button',{name:'Get quote',exact:true})).toBeEnabled()
    const state=await page.evaluate(()=>window.__wallet)
    assert.deepEqual(state.added,[d.walletAddChain]);assert.equal(state.switched.length,2)
    await quote(page)
    await page.evaluate(a=>window.__wallet.emit('accountsChanged',[a]),alternate)
    await expect(page.getByRole('button',{name:'Get quote',exact:true})).toBeVisible()
    await context.close()
  })
  await record('Buy validation, failed simulation blocks signing, successful swap encoding and receipt',async()=>{
    const {page,context,s}=await setup();await live(page);await connect(page)
    await page.getByLabel('You pay',{exact:true}).fill('-2');await page.getByRole('button',{name:'Get quote',exact:true}).click();await expect(page.getByRole('alert')).toContainText('positive amount')
    await page.getByLabel('You pay',{exact:true}).fill('100');await page.getByRole('button',{name:'Get quote',exact:true}).click();await expect(page.getByRole('alert')).toContainText('Insufficient ETH')
    await page.getByLabel('You pay',{exact:true}).fill('0.001');await page.getByText('Advanced swap details').click();await page.getByLabel('Hook data (hex)').fill('0x1234');await quote(page)
    await expect(page.getByRole('button',{name:'Swap ETH for GASP'})).toBeDisabled()
    await page.getByLabel(/I understand the output/).check();s.revertSwap=true
    await page.getByRole('button',{name:'Swap ETH for GASP'}).click();await expect(page.getByRole('alert')).toContainText('Price limit simulation failed');assert.equal(s.txs.length,0)
    s.revertSwap=false;await page.getByRole('button',{name:'Swap ETH for GASP'}).click();await expect(page.locator('[role="status"]')).toContainText('Transaction confirmed')
    const tx=s.txs[0], decoded=decodeFunctionData({abi:abis.PoolSwapTest,data:tx.data})
    assert.equal(tx.to.toLowerCase(),d.integrations.poolSwapTest);assert.equal(BigInt(tx.value),10n**15n);assert.equal(BigInt(tx.gasPrice),2000000000n)
    assert.deepEqual(decoded.args[0],key);assert.equal(decoded.args[1].amountSpecified,-(10n**15n));assert.equal(decoded.args[1].zeroForOne,true);assert(decoded.args[1].sqrtPriceLimitX96<1000n*2n**96n)
    assert.deepEqual(decoded.args[2],{takeClaims:false,settleUsingBurn:false});assert.equal(decoded.args[3],'0x1234')
    await context.close()
  })
  await record('Sell exact-amount router approval, refreshed quote, wallet rejection and successful sell',async()=>{
    const {page,context,s}=await setup();await live(page);await connect(page)
    await page.getByRole('button',{name:'Sell GASP',exact:true}).click();await page.getByLabel('You pay',{exact:true}).fill('1000');await quote(page)
    await page.getByRole('button',{name:'Approve 1,000 GASP'}).click();await expect(page.locator('[role="status"]')).toContainText('Transaction confirmed')
    const approval=decodeFunctionData({abi:abis.GASP,data:s.txs[0].data});assert.equal(approval.args[0].toLowerCase(),d.integrations.poolSwapTest);assert.equal(approval.args[1],1000n*10n**18n)
    await quote(page);await page.getByLabel(/I understand the output/).check();await page.evaluate(()=>window.__wallet.reject=true)
    await page.getByRole('button',{name:'Swap GASP for ETH'}).click();await expect(page.getByRole('alert')).toContainText('Request declined');assert.equal(s.txs.length,1)
    await page.evaluate(()=>window.__wallet.reject=false);await page.getByRole('button',{name:'Swap GASP for ETH'}).click();await expect(page.locator('[role="status"]')).toContainText('Transaction confirmed')
    const swap=decodeFunctionData({abi:abis.PoolSwapTest,data:s.txs[1].data});assert.equal(swap.args[1].zeroForOne,false);assert.equal(swap.args[1].amountSpecified,-1000n*10n**18n);assert(swap.args[1].sqrtPriceLimitX96>1000n*2n**96n);assert.equal(BigInt(s.txs[1].value??'0x0'),0n)
    await context.close()
  })
  await record('Donation simulation, exact pool key, successful receipt and empty accrual state',async()=>{
    const {page,context,s}=await setup();await live(page);await connect(page)
    await page.getByRole('button',{name:'Donate fees'}).click();await expect(page.locator('[role="status"]')).toContainText('Transaction confirmed')
    assert.equal(s.txs[0].to.toLowerCase(),hook);const call=decodeFunctionData({abi:abis.GasPriceFeeHook,data:s.txs[0].data});assert.equal(call.functionName,'donateFees');assert.deepEqual(call.args[0],key)
    await expect(page.getByRole('button',{name:'Donate fees'})).toBeDisabled();await context.close()
  })
  await record('Empty event window and zero in-range liquidity disable donation',async()=>{
    const {page,context}=await setup({liquidity:0n,empty:true});await live(page);await connect(page)
    await expect(page.getByRole('button',{name:'Donate fees'})).toBeDisabled();await expect(page.getByText('No swaps in this block window')).toBeVisible();await expect(page.getByText(/No in-range liquidity. Fees stay/)).toBeVisible();await context.close()
  })
  await record('Quote expiration and wallet disconnect invalidate swap controls',async()=>{
    const {page,context}=await setup();await live(page);await connect(page);await quote(page)
    await page.clock.install();await page.clock.fastForward(46000)
    await expect(page.getByText('Quote expired',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Swap ETH for GASP'})).toBeDisabled()
    await page.getByRole('button',{name:/Disconnect/}).click();await expect(page.getByRole('button',{name:'Connect wallet to swap'})).toBeVisible();await context.close()
  })
  await record('Tampered implementation ABI prevents app initialization',async()=>{
    const {page,context}=await setup({tamper:true});await expect(page.getByRole('alert')).toContainText('Asset verification failed');assert.equal(await page.getByRole('button',{name:'Connect wallet'}).count(),0);await context.close()
  })
  await record('Missing code blocks all transactions and exposes a recoverable error',async()=>{
    const {page,context}=await setup({missingCode:true});await expect(page.getByRole('alert')).toContainText('Unable to verify');await expect(page.getByRole('button',{name:'Donate fees'})).toBeDisabled();await context.close()
  })
  await record('Rendered desktop/mobile/tablet reflow, keyboard focus, local fonts and axe scan',async()=>{
    const {page,context}=await setup();await live(page)
    for(const [width,height] of [[1440,1080],[900,1000],[810,1000],[390,844],[320,800]]) {
      await page.setViewportSize({width,height})
      const overflow=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,elements:[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().right>innerWidth+1 && !e.closest('.table-wrap')).map(e=>({tag:e.tagName,cls:e.className,right:e.getBoundingClientRect().right})).slice(0,15)}))
      await page.screenshot({path:resolve(root,`docs/frontend/${width}.png`),fullPage:true})
      assert(overflow.scrollWidth<=width,`Page overflows: ${JSON.stringify(overflow)}`)
      const scan=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()
      assert.deepEqual(scan.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})),[],`Accessibility violations at ${width}`)
      await page.screenshot({path:resolve(root,`docs/frontend/${width}.png`),fullPage:true})
    }
    await page.setViewportSize({width:1440,height:1080});await page.goto(url);await live(page)
    await page.keyboard.press('Tab');await expect(page.getByRole('link',{name:'Skip to content'})).toBeFocused();await page.keyboard.press('Enter')
    await page.getByRole('button',{name:'Connect wallet',exact:true}).focus();await page.keyboard.press('Enter');await expect(page.getByRole('button',{name:/Disconnect/})).toBeVisible()
    await page.getByLabel('Your transaction gas price').focus();await page.screenshot({path:resolve(root,'docs/frontend/keyboard-focus.png'),fullPage:false})
    await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.locator('.button').first().evaluate(e=>getComputedStyle(e).transitionDuration),'0s')
    assert(await page.evaluate(()=>document.fonts.check('500 16px "DM Sans"')))
    await writeFile(resolve(root,'docs/frontend/browser-styles.json'),JSON.stringify(await page.evaluate(()=>{
      const selectors=['body','.muted','.button.primary','.tier-result','.badge.warning','.input-unit',':focus-visible'];return selectors.map(selector=>{const el=document.querySelector(selector);if(!el)return{selector,absent:true};const s=getComputedStyle(el);return{selector,color:s.color,background:s.backgroundColor,font:s.fontFamily,fontSize:s.fontSize,lineHeight:s.lineHeight,outline:s.outlineColor,outlineWidth:s.outlineWidth}})
    }),null,2)+'\n')
    await writeFile(resolve(root,'docs/frontend/contrast.json'),JSON.stringify(await page.evaluate(()=>{
      const luminance=rgb=>{const channels=rgb.match(/[\d.]+/g).slice(0,3).map(Number).map(n=>n/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4);return channels[0]*.2126+channels[1]*.7152+channels[2]*.0722}
      const background=el=>{for(let e=el;e;e=e.parentElement){const c=getComputedStyle(e).backgroundColor;if(c!=='rgba(0, 0, 0, 0)')return c}return 'rgb(255, 255, 255)'}
      const ratio=(a,b)=>{const x=luminance(a),y=luminance(b);return Number(((Math.max(x,y)+.05)/(Math.min(x,y)+.05)).toFixed(2))}
      return ['body','.muted','.button.primary','.tier-result','.badge.warning','.router-note',':focus-visible','.input-unit'].map(selector=>{const e=document.querySelector(selector),style=getComputedStyle(e),bg=background(e),foreground=selector===':focus-visible'?style.outlineColor:selector==='.input-unit'?style.borderColor:style.color;return{selector,foreground,background:bg,ratio:ratio(foreground,bg),requirement:selector===':focus-visible'||selector==='.input-unit'?3:4.5}})
    }),null,2)+'\n')
    await context.close()
  })
  assert.deepEqual(errors,[],'Unexpected browser console or resource errors')
  await writeFile(resolve(root,'docs/frontend/browser-results.json'),JSON.stringify({date:new Date().toISOString(),browser:'Playwright Chromium 140',servedAt:'/preview/',mode:'mocked RPC and injected wallet; no broadcasts',passed:results,consoleErrors:errors},null,2)+'\n')
} finally { await browser.close();await new Promise(resolve=>server.close(resolve)) }
