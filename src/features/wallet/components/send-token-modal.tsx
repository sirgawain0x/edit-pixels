import { ArrowUpRight, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useSendTokenForm } from '@/features/wallet/hooks/use-send-token-form'
import { SendTokenFundingHints } from '@/features/wallet/components/send-token-funding-hints'
import type { SendToken } from '@/features/wallet/lib/send-token-math'
import { cn } from '@/shared/ui/cn'

interface SendTokenModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SendTokenModal({ open, onOpenChange }: SendTokenModalProps) {
  const form = useSendTokenForm(open, onOpenChange)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowUpRight className="h-5 w-5" aria-hidden />
            Send tokens
          </DialogTitle>
          <DialogDescription>
            Send USDC or CRTVAI from your smart wallet to another address.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <label htmlFor="send-token" className="text-sm font-medium">
              Token
            </label>
            <Select
              value={form.token}
              onValueChange={(value) => form.setToken(value as SendToken)}
              disabled={form.sending}
            >
              <SelectTrigger id="send-token" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="usdc">USDC</SelectItem>
                {form.crtvaiAvailable && <SelectItem value="crtvai">CRTVAI</SelectItem>}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Available:</span>
            <span className="font-medium">
              {form.balanceFormatted} {form.tokenSymbol}
            </span>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="send-recipient" className="text-sm font-medium">
              Recipient address
            </label>
            <Input
              id="send-recipient"
              placeholder="0x…"
              value={form.recipient}
              onChange={(e) => form.setRecipient(e.target.value.trim())}
              disabled={form.sending}
              className="font-mono text-xs"
            />
            {form.recipient && !form.recipientValid && (
              <p className="text-xs text-destructive">Enter a valid Ethereum address.</p>
            )}
            {form.sendToSelf && (
              <p className="text-xs text-destructive">Cannot send to your own wallet.</p>
            )}
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label htmlFor="send-amount" className="text-sm font-medium">
                Amount
              </label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={form.handleMax}
                disabled={form.sending || form.maxSendableWei <= 0n}
              >
                Max
              </Button>
            </div>
            <Input
              id="send-amount"
              type="number"
              min="0"
              step={form.token === 'usdc' ? '0.01' : '0.0001'}
              placeholder="0.00"
              value={form.amountInput}
              onChange={(e) => form.setAmountInput(e.target.value)}
              disabled={form.sending}
            />
            <SendTokenFundingHints
              token={form.token}
              amountInput={form.amountInput}
              gasBufferUsdc6={form.gasBufferUsdc6}
              insufficientBalance={form.insufficientBalance}
              canSendFromSigner={form.canSendFromSigner}
              needsMoveToSmartWallet={form.needsMoveToSmartWallet}
              transferring={form.transferring}
              sending={form.sending}
              onMoveUsdcToSmartWallet={() => void form.handleMoveUsdcToSmartWallet()}
            />
          </div>

          {!form.onBase && form.token === 'crtvai' && (
            <p className="text-xs text-amber-500">Switch to Base network to send CRTVAI.</p>
          )}

          <Button
            onClick={() => void form.handleSend()}
            disabled={!form.canSend}
            className={cn('w-full', form.sending && 'opacity-80')}
          >
            {form.sending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Sending…
              </>
            ) : form.canSendFromSigner ? (
              `Send ${form.tokenSymbol} from signer`
            ) : (
              `Send ${form.tokenSymbol}`
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
