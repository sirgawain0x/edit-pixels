import { useCallback, useState } from 'react'
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

const BASE_EXPLORER_ADDRESS_URL = 'https://basescan.org/address'

export function ReceiveFundsModal({ open, onOpenChange }: ReceiveFundsModalProps) {
  const { account, chain, switchChain } = useWalletContext()
  const [copied, setCopied] = useState(false)
  const [switching, setSwitching] = useState(false)

  const onBase = chain.id === base.id

  const handleCopy = useCallback(() => {
    if (!account) return
    void navigator.clipboard.writeText(account).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    })
  }, [account])

  const handleSwitchToBase = useCallback(async () => {
    setSwitching(true)
    try {
      await switchChain(base.id)
    } finally {
      setSwitching(false)
    }
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
            Copy your smart wallet address or scan the QR code to receive USDC on Base.
          </DialogDescription>
        </DialogHeader>

        {!account ? (
          <p className="py-4 text-sm text-muted-foreground">
            Connect your wallet to receive funds.
          </p>
        ) : !onBase ? (
          <div className="space-y-3 py-2">
            <p className="text-sm text-amber-200/90">
              Receive is available on Base. Switch networks to show your deposit address.
            </p>
            <Button
              type="button"
              className="w-full"
              disabled={switching}
              onClick={() => void handleSwitchToBase()}
            >
              {switching ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                  Switching…
                </>
              ) : (
                'Switch to Base'
              )}
            </Button>
          </div>
        ) : (
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

            <div className="space-y-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200/90">
              <p className="font-medium text-amber-100">Send from Coinbase (or any wallet)</p>
              <ol className="list-decimal space-y-1 pl-4">
                <li>Choose asset: USDC</li>
                <li>Choose network: Base (not Solana or Ethereum)</li>
                <li>Paste this address or scan the QR above</li>
              </ol>
              <p>Funds sent on the wrong network may be lost.</p>
            </div>

            <a
              href={`${BASE_EXPLORER_ADDRESS_URL}/${account}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
            >
              View on explorer
              <ExternalLink className="h-3 w-3" aria-hidden />
            </a>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
