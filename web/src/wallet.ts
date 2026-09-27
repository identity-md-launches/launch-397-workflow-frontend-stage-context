import { connect, disconnect, getAccount, watchAccount } from '@wagmi/core'
import { useEffect, useState } from 'react'
import { createWalletClient, custom, type Address, type EIP1193Provider } from 'viem'
import type { Runtime } from './config'

export async function switchNetwork(provider: EIP1193Provider, r: Runtime) {
  try { await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: r.deployment.walletAddChain.chainId }] }) }
  catch (error) {
    const e = error as { code?: number; message?: string; cause?: { code?: number } }
    if (e.code !== 4902 && e.cause?.code !== 4902 && !/unknown chain|unrecognized chain|chain.*not.*added/i.test(e.message ?? '')) throw error
    await provider.request({ method: 'wallet_addEthereumChain', params: [r.deployment.walletAddChain] })
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: r.deployment.walletAddChain.chainId }] })
  }
}

export function useWallet(r: Runtime) {
  const [account, setAccount] = useState(() => getAccount(r.wagmi))
  useEffect(() => watchAccount(r.wagmi, { onChange: setAccount }), [r])
  const provider = async () => {
    const connector = getAccount(r.wagmi).connector
    if (!connector) throw Error('Connect a browser wallet first.')
    return await connector.getProvider() as EIP1193Provider
  }
  return {
    address: account.address, chainId: account.chainId,
    connect: async () => {
      const connector = r.wagmi.connectors[0]
      if (!connector || !await connector.getProvider()) throw Error('No browser wallet found. Open this page in a wallet browser or install an Ethereum wallet, then reload.')
      await connect(r.wagmi, { connector })
    },
    disconnect: () => disconnect(r.wagmi),
    switch: async () => switchNetwork(await provider(), r),
    signer: async (expected: Address) => {
      const p = await provider()
      const [chain, accounts] = await Promise.all([p.request({ method: 'eth_chainId' }), p.request({ method: 'eth_accounts' })])
      if (Number(chain) !== r.chain.id) throw Error(`Switch your wallet to ${r.chain.name} before continuing.`)
      if (accounts[0]?.toLowerCase() !== expected.toLowerCase()) throw Error('Wallet account changed. Refresh the quote and try again.')
      return createWalletClient({ account: expected, chain: r.chain, transport: custom(p) })
    },
  }
}
