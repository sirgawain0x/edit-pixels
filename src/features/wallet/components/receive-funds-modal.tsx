import { useCallback, useEffect, useState } from 'react'
import { Copy, ExternalLink, Loader2, QrCode } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { base } from 'viem/chains'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useWalletContext } from '@/context/wallet-context'

interface ReceiveFundsModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** USDC and CRTVAI for this app are received on Base. */
const RECEIVE_CHAIN_ID = base.id

function baseExplorerAddressUrl(address: string): string {
  return `https://basescan.org/address/${address}`
}

export function ReceiveFundsModal({ open, onOpenChange }: ReceiveFundsModalProps) {
  const { account, chain, switchChain, smartAccountStatus } = useWalletContext()
  const [copied, setCopied] = useState(false)
  const [switchingToBase, setSwitchingToBase] = useState(false)
  const [switchError, setSwitchError] = useState<string | null>(null)

  const onBase = chain.id === RECEIVE_CHAIN_ID
  const showReceiveDetails = Boolean(
    account && onBase && smartAccountStatus === 'ready' && !switchingToBase,
  )

  useEffect(() => {
    if (!open) {
      setSwitchingToBase(false)
      setSwitchError(null)
      return
    }
    if (!switchingToBase) return
    if (smartAccountStatus === 'error') {
      setSwitchingToBase(false)
      return
    }
    if (onBase && smartAccountStatus === 'ready' && account) {
      setSwitchingToBase(false)
    }
  }, [account, onBase, open, smartAccountStatus, switchingToBase])

  const handleCopy = useCallback(() => {
    if (!account || !showReceiveDetails) return
    void navigator.clipboard.writeText(account).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    })
  }, [account, showReceiveDetails])

  const handleSwitchToBase = useCallback(() => {
    setSwitchError(null)
    setSwitchingToBase(true)
    void switchChain(RECEIVE_CHAIN_ID).catch(() => {
      setSwitchingToBase(false)
      setSwitchError('Could not switch to Base.')
    })
  }, [switchChain])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <QrCode className="h-5 w-5" aria-hidden />
            Receive funds
          </DialogTitle>
          <DialogDescription>
            Copy your Base smart wallet address to receive USDC or CRTVAI.
          </DialogDescription>
        </DialogHeader>

        {showReceiveDetails && account ? (
          <div className="space-y-4 py-2">
            <div className="flex justify-center rounded-lg border bg-white p-4">
              <QRCodeSVG value={account} size={192} level="M" includeMargin />
            </div>

            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">Smart wallet address</p>
              <div className="flex items-start gap-2 rounded-md border bg-muted/40 px-3 py-2">
                <p className="min-w-0 flex-1 break-all font-mono text-xs text-foreground">
                  {account}
                </p>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0"
                  onClick={handleCopy}
                  aria-label="Copy address"
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
              {copied && <p className="text-xs text-emerald-400">Copied</p>}
            </div>

            <ol className="list-decimal space-y-1 pl-4 text-xs text-amber-200/90">
              <li>In Coinbase, choose USDC.</li>
              <li>Set the network to Base.</li>
              <li>Paste this address or scan the code.</li>
            </ol>

            <a
              href={baseExplorerAddressUrl(account)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
            >
              View on explorer
              <ExternalLink className="h-3 w-3" aria-hidden />
            </a>
          </div>
        ) : !onBase || switchingToBase ? (
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              USDC arrives on Base. Switch this wallet to Base to copy your receive address.
            </p>
            {switchError && <p className="text-xs text-destructive">{switchError}</p>}
            <Button
              type="button"
              className="w-full"
              onClick={handleSwitchToBase}
              disabled={switchingToBase}
            >
              {switchingToBase ? (
                <>
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                  Switching to Base…
                </>
              ) : (
                'Switch to Base'
              )}
            </Button>
          </div>
        ) : (
          <p className="py-4 text-sm text-muted-foreground">
            {smartAccountStatus === 'pending'
              ? 'Preparing your Base smart wallet…'
              : 'Connect your wallet to receive funds.'}
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}
