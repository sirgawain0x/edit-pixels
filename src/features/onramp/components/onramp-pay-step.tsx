import { Button } from '@/components/ui/button'

interface OnrampPayStepProps {
  paymentLink: string
  payStatus: string | null
  error: string | null
  onStartOver: () => void
}

export function OnrampPayStep({ paymentLink, payStatus, error, onStartOver }: OnrampPayStepProps) {
  return (
    <div className="space-y-3">
      {payStatus ? <p className="text-sm text-muted-foreground">{payStatus}</p> : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <iframe
        title="Coinbase Onramp"
        src={paymentLink}
        className="h-[420px] w-full rounded-md border bg-background"
        allow="payment"
        sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
        referrerPolicy="no-referrer"
      />
      <Button type="button" variant="outline" className="w-full" onClick={onStartOver}>
        Start over
      </Button>
    </div>
  )
}
