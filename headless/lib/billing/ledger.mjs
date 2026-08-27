import fs from 'node:fs'
import path from 'node:path'

/**
 * File-backed credit ledger for Pixels MCP billing.
 *
 * Each account is keyed by a wallet address or API key. The ledger tracks a
 * USDC6-equivalent credit balance that can be spent against render/edit
 * operations. The file store is intentionally simple so it runs locally on a
 * Jetson or self-hosted renderer without requiring a database.
 *
 * In production this should be swapped for a durable store (Supabase, Upstash,
 * or a SQL database) so multiple renderer nodes share the same ledger.
 *
 * All amounts are integers in usdc6 (USDC with 6 decimals).
 */

export class CreditLedger {
  /**
   * @param {object} options
   * @param {string} options.storePath - path to the JSON ledger file
   */
  constructor({ storePath }) {
    this.storePath = storePath
    this.data = this.#load()
  }

  // fallow-ignore-next-line complexity
  #load() {
    try {
      const raw = fs.readFileSync(this.storePath, 'utf8')
      const parsed = JSON.parse(raw)
      return {
        version: parsed.version ?? 1,
        accounts: parsed.accounts ?? {},
        txs: parsed.txs ?? [],
      }
    } catch (error) {
      if (error.code === 'ENOENT') {
        return { version: 1, accounts: {}, txs: [] }
      }
      throw error
    }
  }

  #save() {
    const dir = path.dirname(this.storePath)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(this.storePath, JSON.stringify(this.data, null, 2))
  }

  #account(accountId) {
    if (!this.data.accounts[accountId]) {
      this.data.accounts[accountId] = { balanceUsdc6: 0 }
    }
    return this.data.accounts[accountId]
  }

  #record(tx) {
    this.data.txs.push({
      id: `tx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      time: new Date().toISOString(),
      ...tx,
    })
  }

  /**
   * Returns the current balance for an account.
   * @param {string} accountId - wallet address or API key
   * @returns {number} balance in usdc6
   */
  getBalance(accountId) {
    return this.#account(accountId).balanceUsdc6
  }

  /**
   * Add credit to an account, e.g. after verifying a CRTVAI deposit.
   * @param {string} accountId
   * @param {number} amountUsdc6
   * @param {object} [metadata]
   */
  credit(accountId, amountUsdc6, metadata = {}) {
    const amount = Math.max(0, Math.floor(Number(amountUsdc6) || 0))
    if (amount === 0) return this.getBalance(accountId)

    const account = this.#account(accountId)
    account.balanceUsdc6 += amount
    this.#record({
      accountId,
      type: 'credit',
      amountUsdc6: amount,
      metadata,
    })
    this.#save()
    return account.balanceUsdc6
  }

  /**
   * Reserve an estimated amount before starting work. Returns a reservation id.
   * Use finalizeReservation or releaseReservation to settle.
   *
   * Reservations prevent concurrent operations from over-drawing the same
   * balance. They are held in memory only; a persistent ledger should store
   * them in the data file for multi-process safety.
   *
   * @param {string} accountId
   * @param {number} estimateUsdc6
   * @returns {{ok: true, reservationId: string} | {ok: false, reason: string}}
   */
  reserve(accountId, estimateUsdc6) {
    const available = this.availableBalance(accountId)
    if (available < estimateUsdc6) {
      return {
        ok: false,
        reason: `Insufficient credits. Available: ${available} usdc6, required: ${estimateUsdc6} usdc6`,
      }
    }

    const reservations = (this.#account(accountId).reservations ??= {})
    const reservationId = `res-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    reservations[reservationId] = {
      estimateUsdc6: Math.floor(Number(estimateUsdc6) || 0),
      createdAt: new Date().toISOString(),
    }
    this.#save()
    return { ok: true, reservationId }
  }

  /**
   * Release a reservation without charging.
   * @param {string} accountId
   * @param {string} reservationId
   */
  releaseReservation(accountId, reservationId) {
    const account = this.#account(accountId)
    const reservations = account.reservations ?? {}
    if (reservations[reservationId]) {
      delete reservations[reservationId]
      this.#save()
    }
  }

  /**
   * Finalize a reservation, charging the actual amount.
   * Any over-reservation is returned to the account.
   * @param {string} accountId
   * @param {string} reservationId
   * @param {number} actualUsdc6
   */
  // fallow-ignore-next-line complexity
  finalizeReservation(accountId, reservationId, actualUsdc6) {
    const account = this.#account(accountId)
    const reservations = account.reservations ?? {}
    const reservation = reservations[reservationId]
    if (!reservation) {
      throw new Error(`Reservation not found: ${reservationId}`)
    }

    const actual = Math.max(0, Math.floor(Number(actualUsdc6) || 0))
    const charged = actual
    const returned = Math.max(0, reservation.estimateUsdc6 - actual)

    if (account.balanceUsdc6 < charged) {
      throw new Error(
        `Insufficient credits to settle reservation: need ${charged} usdc6, have ${account.balanceUsdc6} usdc6`,
      )
    }

    account.balanceUsdc6 -= charged
    delete reservations[reservationId]

    this.#record({
      accountId,
      type: 'debit',
      amountUsdc6: charged,
      estimateUsdc6: reservation.estimateUsdc6,
      returnedUsdc6: returned,
      metadata: { reservationId },
    })

    this.#save()
    return { chargedUsdc6: charged, returnedUsdc6: returned, balanceUsdc6: account.balanceUsdc6 }
  }

  /**
   * Available balance excluding active reservations.
   * @param {string} accountId
   * @returns {number} usdc6
   */
  availableBalance(accountId) {
    const account = this.#account(accountId)
    const reserved = Object.values(account.reservations ?? {}).reduce(
      (sum, r) => sum + r.estimateUsdc6,
      0,
    )
    return Math.max(0, account.balanceUsdc6 - reserved)
  }

  /**
   * Returns true when a CRTVAI deposit tx hash was already credited.
   * @param {string} txHash
   */
  hasDepositTx(txHash) {
    const normalized = txHash?.trim().toLowerCase()
    if (!normalized) return false
    return this.data.txs.some(
      (tx) =>
        tx.type === 'credit' &&
        typeof tx.metadata?.txHash === 'string' &&
        tx.metadata.txHash.toLowerCase() === normalized,
    )
  }

  /**
   * Human-readable account summary.
   * @param {string} accountId
   */
  summary(accountId) {
    const balance = this.getBalance(accountId)
    const available = this.availableBalance(accountId)
    return {
      accountId,
      balanceUsdc6: balance,
      availableUsdc6: available,
      reservedUsdc6: balance - available,
    }
  }
}
