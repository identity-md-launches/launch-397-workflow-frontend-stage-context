import { useCallback, useEffect, useRef, useState } from 'react'
import { isHex, type Hash } from 'viem'
import type { Runtime, Client } from './config'
import { verifiedClient } from './config'
import { readHistory, readSnapshot, type Snapshot } from './chain'
import { useWallet } from './wallet'
import { deltaAmounts, errorText, feeBpsFor, MIN_TIP, parseAmount, priceLimit, short, units } from './math'

const Bolt = () => <svg aria-hidden="true" viewBox="0 0 24 24" fill="none"><path d="m14 2-9 12h7l-2 8 9-12h-7l2-8Z" fill="currentColor"/></svg>
const Arrow = () => <span aria-hidden="true">↗</span>
function External({ href, children, className = '' }: { href: string; children: React.ReactNode; className?: string }) {
  return <a href={href} target="_blank" rel="noreferrer" className={className}>{children} <Arrow/><span className="sr-only"> (opens in a new tab)</span></a>
}
type Quote = { amount: bigint; output: bigint; limit: bigint; created: number; buy: boolean; gasPrice: bigint; hookData: `0x${string}`; tolerance: number }

export default function App({ runtime: r }: { runtime: Runtime }) {
  const wallet = useWallet(r)
  const [client, setClient] = useState<Client>()
  const [data, setData] = useState<Snapshot>()
  const [history, setHistory] = useState<Awaited<ReturnType<typeof readHistory>>>()
  const [readError, setReadError] = useState('')
  const [historyError, setHistoryError] = useState('')
  const [actionError, setActionError] = useState('')
  const [fieldError, setFieldError] = useState<{ id: string; message: string }>()
  const [status, setStatus] = useState('')
  const [hash, setHash] = useState<Hash>()
  const [busy, setBusy] = useState('')
  const [loading, setLoading] = useState(true)
  const [buy, setBuy] = useState(true)
  const [amount, setAmount] = useState('0.001')
  const [gasPriceInput, setGasPriceInput] = useState('2')
  const [tolerance, setTolerance] = useState('0.5')
  const [hookData, setHookData] = useState('0x')
  const [accepted, setAccepted] = useState(false)
  const [quote, setQuote] = useState<Quote>()
  const [clock, setClock] = useState(Date.now())
  const [onlyHigh, setOnlyHigh] = useState(false)
  const refreshId = useRef(0)
  const refreshInFlight = useRef(false)
  const activeClient = useRef<Client | undefined>(undefined)
  const actionLock = useRef(false)
  const formEpoch = useRef(0)
  const network = r.deployment.network
  const explorer = network.explorer
  const wrongChain = !!wallet.address && wallet.chainId !== r.chain.id
  const stale = !data || clock - data.updatedAt > 60_000
  const ready = !!client && !!data && !readError && !stale
  const canAct = ready && !!wallet.address && !wrongChain && !busy
  let gasPrice: bigint | undefined
  try { gasPrice = parseAmount(gasPriceInput, 9) } catch { /* The field reports this inline. */ }
  const tier = data && gasPrice !== undefined ? feeBpsFor(gasPrice, data.baseFee) : undefined
  const gasInvalid = !gasPrice || !!data && gasPrice < data.baseFee
  const quoteFresh = !!quote && clock - quote.created < 45_000
  const needsApproval = !buy && !!quote && !!data && data.allowance < quote.amount
  const symbol = data?.symbol ?? 'GASP'

  const refresh = useCallback(async () => {
    if (refreshInFlight.current) return
    refreshInFlight.current = true
    const id = ++refreshId.current
    setLoading(true)
    try {
      const active = activeClient.current ?? await verifiedClient(r)
      const next = await readSnapshot(r, active, wallet.address)
      if (id !== refreshId.current) return
      activeClient.current = active; setClient(active); setData(next); setReadError('')
      try {
        const events = await readHistory(r, active, next.block)
        if (id === refreshId.current) { setHistory(events); setHistoryError('') }
      } catch (error) { if (id === refreshId.current) setHistoryError(errorText(error)) }
    } catch (error) {
      if (id === refreshId.current) { activeClient.current = undefined; setReadError(errorText(error)); setClient(undefined); setQuote(undefined) }
    } finally { if (id === refreshId.current) { refreshInFlight.current = false; setLoading(false) } }
  }, [r, wallet.address])

  useEffect(() => { void refresh(); const t = setInterval(() => void refresh(), 20_000); return () => { clearInterval(t); refreshId.current++; refreshInFlight.current = false } }, [refresh])
  useEffect(() => { const t = setInterval(() => setClock(Date.now()), 1000); return () => clearInterval(t) }, [])
  useEffect(() => { formEpoch.current++; setQuote(undefined); setAccepted(false); setActionError(''); setFieldError(undefined) }, [buy, amount, tolerance, gasPriceInput, hookData, wallet.address, wallet.chainId])
  useEffect(() => { setData(undefined) }, [wallet.address])

  async function action(label: string, fn: () => Promise<void>) {
    if (actionLock.current) return
    actionLock.current = true; setBusy(label); setActionError(''); setStatus(''); setHash(undefined)
    try { await fn() } catch (error) { setActionError(errorText(error)); setStatus('') }
    finally { actionLock.current = false; setBusy('') }
  }
  async function confirmed(tx: Hash) {
    setHash(tx); setStatus('Transaction submitted. Waiting for confirmation…')
    const receipt = await client!.waitForTransactionReceipt({ hash: tx, timeout: 180_000 })
    if (receipt.status !== 'success') throw Error('Transaction reverted on-chain. Open the transaction for details, then refresh and try again.')
    setStatus('Transaction confirmed. Pool and wallet balances refreshed.')
    setQuote(undefined); await refresh()
  }
  async function getQuote() {
    const epoch = formEpoch.current
    if (!canAct || !data || !gasPrice || !client || !wallet.address) throw Error('Connect to the correct network and refresh live state before quoting.')
    const invalid = (id: string, message: string): never => { setFieldError({ id, message }); document.getElementById(id)?.focus(); throw Error(message) }
    let value: bigint
    try { value = parseAmount(amount, buy ? network.nativeCurrency.decimals : data.decimals) } catch (error) { return invalid('amount', errorText(error)) }
    const bps = Number(tolerance) * 100
    if (!Number.isInteger(bps) || bps < 1 || bps > 500) return invalid('tolerance', 'Choose a price tolerance from 0.01% to 5%.')
    if (!isHex(hookData) || hookData.length % 2 !== 0) return invalid('hook-data', 'Hook data must be an even-length hexadecimal value beginning with 0x.')
    if (value > (buy ? data.ethBalance : data.balance)) return invalid('amount', `Insufficient ${buy ? 'ETH' : symbol} balance. Reduce the amount or fund your wallet.`)
    const latest = await readSnapshot(r, client, wallet.address)
    if (gasPrice < latest.baseFee) throw Error('Gas price is below the current base fee. Increase it and request another quote.')
    const limit = priceLimit(latest.sqrtPrice, bps, buy)
    const result = await client.simulateContract({ address: network.uniswapV4.quoter, abi: r.abis.V4Quoter, functionName: 'quoteExactInputSingle', args: [{ poolKey: r.key, zeroForOne: buy, exactAmount: value, hookData }], account: wallet.address, gasPrice })
    const [output] = result.result as readonly [bigint, bigint]
    if (epoch !== formEpoch.current) throw Error('Wallet or form changed while quoting. Request another quote.')
    if (output <= 0n) throw Error('This quote returns no output. Try a smaller amount or wait for liquidity.')
    setData(latest); setQuote({ amount: value, output, limit, created: Date.now(), buy, gasPrice, hookData, tolerance: bps }); setClock(Date.now())
    setStatus('Quote ready. Review the output and price limit before continuing.')
  }
  async function approve() {
    if (!canAct || !quote || !quoteFresh || !wallet.address || !client) throw Error('Refresh the quote before approving.')
    setStatus(`Simulating approval for ${units(quote.amount, data!.decimals)} ${symbol}…`)
    const simulation = await client.simulateContract({ address: r.token.address, abi: r.abis.GASP, functionName: 'approve', args: [r.deployment.integrations.poolSwapTest, quote.amount], account: wallet.address })
    const signer = await wallet.signer(wallet.address)
    await confirmed(await signer.writeContract(simulation.request))
  }
  async function swap() {
    if (!canAct || !quote || !quoteFresh || !accepted || needsApproval || !wallet.address || !client) throw Error('Refresh the quote, complete approval if needed, and acknowledge the router limits.')
    const selected = quote
    const epoch = formEpoch.current
    const account = wallet.address
    const latest = await readSnapshot(r, client, account)
    if (selected.gasPrice < latest.baseFee) throw Error('Base fee has risen above your gas price. Increase it and refresh the quote.')
    setStatus('Simulating the exact swap with your wallet and price limit…')
    const params = { address: r.deployment.integrations.poolSwapTest, abi: r.abis.PoolSwapTest, functionName: 'swap', args: [r.key, { zeroForOne: selected.buy, amountSpecified: -selected.amount, sqrtPriceLimitX96: selected.limit }, { takeClaims: false, settleUsingBurn: false }, selected.hookData], value: selected.buy ? selected.amount : 0n, account, gasPrice: selected.gasPrice } as const
    const simulation = await client.simulateContract(params)
    const delta = deltaAmounts(simulation.result as bigint)
    const output = selected.buy ? delta[1] : delta[0]
    const input = -(selected.buy ? delta[0] : delta[1])
    const previewFloor = selected.output * BigInt(10000 - selected.tolerance) / 10000n
    if (input <= 0n || input > selected.amount || output < previewFloor) throw Error('Simulation no longer meets the quote estimate. Refresh the quote or adjust the price tolerance.')
    const signer = await wallet.signer(account)
    if (epoch !== formEpoch.current) throw Error('Wallet or form changed during simulation. Request another quote.')
    if (Date.now() - selected.created >= 45_000) throw Error('Quote expired during simulation. Request another quote.')
    setStatus('Simulation passed. Confirm the swap in your wallet; the included gas price determines the fee tier.')
    await confirmed(await signer.writeContract(simulation.request))
  }
  async function donate() {
    if (!canAct || !data || data.liquidity === 0n || data.accrued.every(v => v === 0n) || !wallet.address || !client) throw Error('Donation needs accrued fees, in-range liquidity, and a connected wallet on the correct network.')
    setStatus('Simulating donation of all accrued fees to in-range liquidity providers…')
    const simulation = await client.simulateContract({ address: r.hook.address, abi: r.abis.GasPriceFeeHook, functionName: 'donateFees', args: [r.key], account: wallet.address })
    const signer = await wallet.signer(wallet.address)
    await confirmed(await signer.writeContract(simulation.request))
  }
  const rows = history?.rows.filter(row => !onlyHigh || row.highTier) ?? []
  const price = data ? Number(data.sqrtPrice * data.sqrtPrice * 10n ** 18n / 2n ** 192n) / 10 ** data.decimals : undefined

  return <>
    <a className="skip" href="#main">Skip to content</a>
    <header className="site-header"><div className="header-inner">
      <a className="brand" href="#main" aria-label="Gas Tax home"><span className="brand-icon"><Bolt/></span><span>gas tax<span className="brand-period">.</span></span></a>
      <nav aria-label="Page sections"><a href="#monitor">The lab</a><a href="#history">Activity</a><a href="#contracts">Contracts <Arrow/></a></nav>
      <div className="wallet-nav"><span className="network-tag"><span className="dot"/> {network.name} <span className="testnet">testnet</span></span><button className="button dark compact" disabled={!!busy} onClick={() => void action('wallet', async () => { if (wallet.address) await wallet.disconnect(); else await wallet.connect() })}>{busy === 'wallet' ? 'Connecting…' : wallet.address ? `${short(wallet.address)} · Disconnect` : 'Connect wallet'}</button></div>
    </div></header>
    <main id="main" className="shell">
      <section className="intro"><div><div className="eyebrow"><span className="tiny-mark"/> An experiment in fairer fees</div><h1>The price of priority.</h1><p>Bid higher. Give more back. Explore a swap fee that responds<br className="desktop-break"/> to your gas price and returns to the pool.</p></div><div className="lab-mark" aria-hidden="true"><span>GASP / ETH</span><svg viewBox="0 0 176 78" fill="none"><path d="M1 66h38V49h33V31h32V13h71" stroke="currentColor" strokeWidth="2"/><path d="M1 77h174M1 58h174M1 39h174M1 20h174" stroke="currentColor" strokeOpacity=".14"/><circle cx="104" cy="13" r="5" fill="currentColor"/></svg><span>Gas-aware. Pool-aligned.</span></div></section>
      <div className="status-strip"><span><span className={`dot ${ready ? 'live' : ''}`}/>{ready ? 'Live pool data' : loading ? 'Connecting to Sepolia…' : 'Pool data unavailable'}</span><span className="mono">{data ? `Block ${data.block.toLocaleString('en-US')}${stale ? ' · stale' : ''}` : 'Awaiting RPC verification'}</span><button className="text-button" onClick={() => void refresh()} disabled={loading || !!busy}>{loading ? 'Refreshing…' : 'Refresh data'} <span aria-hidden="true">↻</span></button></div>
      {readError && <div className="notice error" role="alert">{readError}</div>}
      {wrongChain && <div className="notice warning">Your wallet is on a different network. Switch to {network.name} to transact.<button className="button" disabled={!!busy} onClick={() => void action('switch', wallet.switch)}>Switch to {network.name}</button></div>}
      <div className="dashboard">
        <div className="monitor-column">
          <section id="monitor" className="panel monitor" aria-labelledby="monitor-title"><div className="section-heading"><h2 id="monitor-title"><span className="section-index">01</span> Gas monitor</h2><span className="small muted">Updates every 20s</span></div>
            <div className="metrics"><div><span className="label">Current base fee</span><div className="metric-number">{units(data?.baseFee, 9, 6)} <span>gwei</span></div><p>The network’s base cost</p></div><div><span className="label">2× base fee threshold</span><div className="metric-number">{units(data ? data.baseFee * 2n : undefined, 9, 6)} <span>gwei</span></div><p>High tier must exceed this</p></div></div>
            <div className="floor-note"><span className="floor-icon" aria-hidden="true">↳</span><p>And a <strong>3 gwei minimum tip.</strong> Both conditions must be met for the high tier.</p></div>
          </section>
          <section className="panel tier-panel" aria-labelledby="tier-title"><div className="section-heading"><h2 id="tier-title"><span className="section-index">02</span> Preview your fee</h2><span className="badge neutral">Before you swap</span></div>
            <div className="preview-grid"><div><label htmlFor="gas-price">Your transaction gas price</label><div className={`input-unit ${gasInvalid ? 'invalid' : ''}`}><input id="gas-price" value={gasPriceInput} inputMode="decimal" autoComplete="off" disabled={!!busy} onChange={e => setGasPriceInput(e.target.value)} aria-describedby="gas-hint" aria-invalid={gasInvalid}/><span>gwei</span></div><p className={`small ${gasInvalid ? 'error-text' : 'muted'}`} id="gas-hint">{gasInvalid ? 'Enter a positive gas price at or above the live base fee.' : data && gasPrice ? `Estimated tip: ${units(gasPrice > data.baseFee ? gasPrice - data.baseFee : 0n, 9)} gwei` : 'Connect to the public RPC to preview the tier.'}</p></div><div className={`tier-result ${tier === 300 ? 'high' : ''}`}><span className="eyebrow">{tier === undefined ? 'Awaiting base fee' : tier === 300 ? '↑ High tier' : '↘ Standard tier'}</span><strong>{tier === undefined ? '—' : tier / 100}<span>%</span></strong><span className="small">hook fee on swap output</span></div></div>
            <div className="tier-scale" aria-hidden="true"><div className={tier === 30 ? 'selected' : ''}/><div className={tier === 300 ? 'selected high' : ''}/></div><div className="tier-labels"><span><strong>0.3%</strong> standard</span><span><strong>3.0%</strong> high priority</span></div>
            <p className="small muted rule">High tier: gas price &gt; 2× base fee <strong>and</strong> tip ≥ {units(MIN_TIP, 9)} gwei. A 0.3% LP fee applies separately. The included block determines the final tier.</p>
          </section>
          <section className="donation-panel" aria-labelledby="donation-title"><div className="section-heading"><h2 id="donation-title"><span className="section-index">03</span> Give back to the pool</h2><span className="return-icon" aria-hidden="true">↗</span></div><p>Collected fees are waiting to become LP rewards.<br/>Anyone can return them to in-range liquidity providers.</p><div className="donation-bottom"><div className="accrued"><div><span className="label">Accrued ETH</span><strong>{units(data?.accrued[0])}</strong></div><div><span className="label">Accrued {symbol}</span><strong>{units(data?.accrued[1], data?.decimals)}</strong></div></div><button className="button" disabled={!canAct || !data || data.liquidity === 0n || data.accrued.every(v => v === 0n)} onClick={() => void action('donate', donate)}>{busy === 'donate' ? 'Donating…' : 'Donate fees'} <Arrow/></button></div><p className="small muted donation-help">{!wallet.address ? 'Connect a wallet to donate. You pay network gas only.' : data?.liquidity === 0n ? 'No in-range liquidity. Fees stay accrued until liquidity is available.' : data?.accrued.every(v => v === 0n) ? 'No accrued fees yet. New swaps will add to this balance.' : 'Donates both balances in full. You pay gas and receive no caller reward.'}</p></section>
        </div>
        <section className="panel swap-panel" aria-labelledby="swap-title"><div className="section-heading"><h2 id="swap-title">Make a swap</h2><span className="badge neutral">Testnet only</span></div><p className="muted small swap-subtitle">A small swap. A different kind of fee.</p>
          <div className="segmented" aria-label="Swap direction"><button aria-pressed={buy} disabled={!!busy} onClick={() => setBuy(true)}>Buy {symbol}</button><button aria-pressed={!buy} disabled={!!busy} onClick={() => setBuy(false)}>Sell {symbol}</button></div>
          <div className="token-field"><div className="field-top"><label htmlFor="amount">You pay</label><span className="small muted">Balance: {wallet.address && data ? units(buy ? data.ethBalance : data.balance, buy ? 18 : data.decimals, 4) : '—'}</span></div><div className="amount-row"><input id="amount" aria-describedby="amount-hint field-error" aria-invalid={fieldError?.id === 'amount'} inputMode="decimal" autoComplete="off" value={amount} disabled={!!busy} onChange={e => setAmount(e.target.value)}/><span className="token-symbol"><span className={`coin ${buy ? 'eth' : ''}`} aria-hidden="true">{buy ? 'Ξ' : 'G'}</span>{buy ? 'ETH' : symbol}</span></div><span className="small muted" id="amount-hint">{buy ? 'Sepolia Ether' : 'Gas Tax'} · Exact input</span></div>
          <div className="direction-marker" aria-hidden="true">↓</div>
          <div className="token-field output"><div className="field-top"><span className="label">You receive · estimate</span>{quote && <span className="small muted">{quoteFresh ? `${Math.max(0, Math.ceil((45000 - clock + quote.created) / 1000))}s left` : 'Quote expired'}</span>}</div><div className="amount-row"><output>{quote ? units(quote.output, buy ? data?.decimals : 18, 6) : '—'}</output><span className="token-symbol"><span className={`coin ${!buy ? 'eth' : ''}`} aria-hidden="true">{buy ? 'G' : 'Ξ'}</span>{buy ? symbol : 'ETH'}</span></div><span className="small muted">{price ? `1 ETH ≈ ${price.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${symbol}` : 'Live pool price will appear here'}</span></div>
          <div className="swap-details"><div><span>Pool LP fee</span><strong>{r.key.fee / 10000}%</strong></div><div><span>Previewed hook fee</span><strong>{tier === undefined ? '—' : `${tier / 100}%`}</strong></div><div><label htmlFor="tolerance">Pool price tolerance</label><div className="small-input"><input id="tolerance" aria-invalid={fieldError?.id === 'tolerance'} value={tolerance} onChange={e => setTolerance(e.target.value)} disabled={!!busy} inputMode="decimal" aria-describedby="router-note field-error"/><span>%</span></div></div></div>
          <details className="advanced"><summary>Advanced swap details</summary><label htmlFor="hook-data">Hook data (hex)</label><input id="hook-data" aria-invalid={fieldError?.id === 'hook-data'} className="code-input" value={hookData} disabled={!!busy} onChange={e => setHookData(e.target.value)} aria-describedby="hook-hint field-error"/><p className="small muted" id="hook-hint">Forwarded to the hook; this hook ignores it. It does not prove wallet identity.</p><span className="small label">sqrtPriceLimitX96</span><code>{quote?.limit.toString() ?? 'Calculated from live price and tolerance'}</code><p className="small muted">Execution: PoolSwapTest. Token sales approve this router directly for the exact input amount.</p></details>
          <p id="field-error" className="small error-text">{fieldError?.message}</p>
          <p id="router-note" className="router-note">PoolSwapTest limits the pool price, but has no guaranteed minimum output or on-chain deadline. A swap can partially fill. Quotes may use a zero base fee and show the standard tier.</p>
          {quote && <label className="check-label"><input type="checkbox" checked={accepted} disabled={!!busy} onChange={e => setAccepted(e.target.checked)}/><span>I understand the output can change and this test router has no minimum-output guarantee.</span></label>}
          {!wallet.address ? <button className="button primary full" disabled={!!busy} onClick={() => void action('wallet', wallet.connect)}>Connect wallet to swap <Arrow/></button> : <>
            <button className={`button ${quoteFresh ? '' : 'primary'} full`} disabled={!canAct || gasInvalid} onClick={() => void action('quote', getQuote)}>{busy === 'quote' ? 'Getting quote…' : quote ? 'Refresh quote' : 'Get quote'} <Arrow/></button>
            {quote && (needsApproval ? <button className="button primary full" disabled={!canAct || !quoteFresh} onClick={() => void action('approve', approve)}>{busy === 'approve' ? 'Approving…' : `Approve ${units(quote.amount, data?.decimals)} ${symbol}`}</button> : <button className="button primary full" disabled={!canAct || !quoteFresh || !accepted} onClick={() => void action('swap', swap)}>{busy === 'swap' ? 'Processing swap…' : `Swap ${buy ? 'ETH' : symbol} for ${buy ? symbol : 'ETH'}`} <Arrow/></button>)}
          </>}
          <p className="small swap-footnote">{wrongChain ? `Switch to ${network.name} above to continue.` : !ready ? 'Actions require verified, fresh pool data.' : 'Simulated before signing. Your wallet stays in control.'}</p>
        </section>
      </div>
      <div className="action-feedback"><div role="status">{status}</div>{hash && <External href={`${explorer}/tx/${hash}`}>View transaction {short(hash)}</External>}{actionError && <div className="notice error" role="alert">{actionError}</div>}</div>
      <section id="history" className="history panel" aria-labelledby="history-title"><div className="section-heading"><div><div className="eyebrow">On-chain observatory</div><h2 id="history-title">Every swap leaves a signal.</h2></div><label className="filter"><input type="checkbox" checked={onlyHigh} onChange={e => setOnlyHigh(e.target.checked)}/> High tier only</label></div><p className="muted small">Recent FeeCharged events for this pool. The sender is the router, not the trader.</p>
        {historyError ? <div className="notice error" role="alert">Activity could not be loaded. Use Refresh data to retry. {historyError}</div> : !history ? <div className="empty"><span className="empty-icon" aria-hidden="true">≋</span><strong>{readError ? 'Activity is unavailable' : 'Reading the pool’s activity…'}</strong><span>Events appear here when the RPC connection is ready.</span></div> : rows.length === 0 ? <div className="empty"><span className="empty-icon" aria-hidden="true">≋</span><strong>{onlyHigh ? 'No high-tier swaps in this window' : 'No swaps in this block window'}</strong><span>{onlyHigh ? 'Clear the filter to see all fee tiers.' : 'New swaps will appear here. Refresh to check again.'}</span></div> : <div className="table-wrap" tabIndex={0} role="region" aria-label="Recent fee events; scroll horizontally on narrow screens"><table><thead><tr><th scope="col">Transaction / block</th><th scope="col">Fee tier</th><th scope="col">Gas price</th><th scope="col">Hook fee</th><th scope="col">Router</th></tr></thead><tbody>{rows.map(row => <tr key={row.id}><td><External href={`${explorer}/tx/${row.hash}`}>{short(row.hash)}</External><span className="block-label">{row.block.toLocaleString('en-US')}</span></td><td><span className={`badge ${row.highTier ? 'warning' : 'neutral'}`}>{row.highTier ? '↑ High · 3%' : 'Standard · 0.3%'}</span></td><td>{units(row.gasPrice, 9)} <span className="muted">gwei</span></td><td>{units(row.fee, row.currency.toLowerCase() === r.token.address.toLowerCase() ? data?.decimals : 18)} {row.currency.toLowerCase() === r.token.address.toLowerCase() ? symbol : 'ETH'}</td><td><External href={`${explorer}/address/${row.sender}`}>{short(row.sender)}</External></td></tr>)}</tbody></table></div>}
        <div className="history-footer"><span>{history ? `Blocks ${history.start.toLocaleString('en-US')}–${history.end.toLocaleString('en-US')} · latest 30 events · refreshes every 20s` : 'Latest 2,000 blocks · up to 30 events'}</span><External href={`${explorer}/address/${r.hook.address}#events`}>View all on explorer</External></div>
      </section>
      <section className="explanation"><div><span className="eyebrow">Built to give back</span><h2>A priority fee,<br/>with a shared upside.</h2></div><div><h3>Two tiers. No admin.</h3><p>The hook collects 0.3% or 3% of swap output, on top of the pool’s LP fee. Anyone can donate those accrued claims back to in-range LPs.</p></div><div><h3>A public bidding experiment.</h3><p>Gas price is chosen by the sender. Private bundles with a low tip and a direct validator payment can avoid the high tier. Zero base fee always means standard tier.</p></div></section>
      <footer id="contracts"><div className="footer-top"><a className="brand" href="#main"><span className="brand-icon"><Bolt/></span><span>gas tax.</span></a><span className="muted small">A Uniswap v4 experiment on {network.name}. No real-value tokens.</span></div><div className="contract-links">{r.deployment.contracts.map(c => <External key={c.name} href={`${explorer}/address/${c.address}`}>{c.name} <span className="mono">{short(c.address)}</span></External>)}<External href={`${explorer}/address/${r.deployment.integrations.poolSwapTest}`}>PoolSwapTest</External><External href={network.faucets[0]}>Get test ETH</External><a href="./imd-deployment.json">Deployment manifest <Arrow/></a></div><details className="deployment-details"><summary>Deployment provenance and full addresses</summary><p>Source commit: <code>{r.deployment.sourceCommit}</code></p><p>Attestation: <code>{r.deployment.attestationHash}</code></p>{r.deployment.contracts.map(c => <p key={c.name}>{c.name}: <code>{c.address}</code></p>)}<p>Pool ID: <code>{r.poolId}</code></p><p className="small muted">ABI hashes and contract presence are checked before enabling actions. Runtime code checks confirm presence, not a new audit or an independent attestation.</p></details></footer>
    </main>
  </>
}
