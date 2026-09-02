import { useCallback, useMemo, useState } from 'react'
import { Copy, ExternalLink, QrCode } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
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

function buildEip681Uri(address: string, chainId: number): string {
  return `ethereum:${address}@${chainId}`
}

function getExplorerAddressUrl(chainId: number, address: string): string | null {
  if (chainId === 8453) return `https://basescan.org/address/${address}`
  if (chainId === 42161) return `https://arbiscan.io/address/${address}`
  return null
}

export function ReceiveFundsModal({ open, onOpenChange }: ReceiveFundsModalProps) {
  const { account, chain } = useWalletContext()
  const [copied, setCopied] = useState(false)

  const qrValue = useMemo(() => {
    if (!account || !chain) return ''
    return buildEip681Uri(account, chain.id)
  }, [account, chain])

  const explorerUrl = useMemo(() => {
    if (!account || !chain) return null
    return getExplorerAddressUrl(chain.id, account)
  }, [account, chain])

  const handleCopy = useCallback(() => {
    if (!account) return
    void navigator.clipboard.writeText(account).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    })
  }, [account])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <QrCode className="h-5 w-5" aria-hidden />
            Receive funds
          </DialogTitle>
          <DialogDescription>
            Scan with your phone wallet or copy your smart wallet address to receive USDC or CRTVAI.
          </DialogDescription>
        </DialogHeader>

        {account && chain ? (
          <div className="space-y-4 py-2">
            <div className="flex justify-center rounded-lg border bg-white p-4">
              <QRCodeSVG value={qrValue} size={192} level="M" includeMargin />
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

            <p className="text-xs text-amber-200/90">
              Send only on {chain.name}. Funds sent on the wrong network may be lost.
            </p>

            {explorerUrl && (
              <a
                href={explorerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
              >
                View on explorer
                <ExternalLink className="h-3 w-3" aria-hidden />
              </a>
            )}
          </div>
        ) : (
          <p className="py-4 text-sm text-muted-foreground">
            Connect your wallet to receive funds.
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}
