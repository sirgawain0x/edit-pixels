// fallow-ignore-file unused-export,complexity,code-duplication
import type { LiveStylePaymentLedger, LiveStyleSpendAuthorization } from './types.js'

export function createInMemoryLiveStylePaymentLedger(): LiveStylePaymentLedger & {
  getAuthorization(sessionId: string): LiveStyleSpendAuthorization | undefined
  getPulled(sessionId: string): number
} {
  const auths = new Map<string, LiveStyleSpendAuthorization>()
  const pulled = new Map<string, number>()

  return {
    async recordAuthorization(auth) {
      auths.set(auth.sessionId, auth)
      pulled.set(auth.sessionId, 0)
    },
    async pullArrears(sessionId, amountUsdc6) {
      const auth = auths.get(sessionId)
      if (!auth) return { ok: false, amountUsdc6: 0, error: 'no_authorization' }
      const prev = pulled.get(sessionId) ?? 0
      const remaining = auth.capUsdc6 - prev
      const amount = Math.min(amountUsdc6, remaining)
      if (amount <= 0) return { ok: false, amountUsdc6: 0, error: 'cap_reached' }
      pulled.set(sessionId, prev + amount)
      return { ok: true, amountUsdc6: amount, txHash: `mock-pull-${sessionId}-${prev + amount}` }
    },
    async trueUp(sessionId, adjustmentUsdc6) {
      const auth = auths.get(sessionId)
      if (!auth) return { ok: false, amountUsdc6: 0, error: 'no_authorization' }
      const prev = pulled.get(sessionId) ?? 0
      const next = Math.max(0, Math.min(auth.capUsdc6, prev + adjustmentUsdc6))
      pulled.set(sessionId, next)
      return { ok: true, amountUsdc6: next - prev }
    },
    getAuthorization(sessionId) {
      return auths.get(sessionId)
    },
    getPulled(sessionId) {
      return pulled.get(sessionId) ?? 0
    },
  }
}
