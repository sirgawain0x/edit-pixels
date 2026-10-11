/**
 * POST /api/live-style-session — create, heartbeat, stop Live Style sessions.
 */
// fallow-ignore-file complexity

import { isPremiumWallet } from './_premium-membership.js'
import {
  getLiveStylePaymentSpender,
  getLiveStyleProviderUrl,
  isLiveStyleEnabled,
  parseCapPresetUsd,
  parseProviderId,
} from './_live-style-config.js'
import { getLiveStylePaymentLedger } from './_live-style-payment-server.js'
import {
  deleteLiveStyleSession,
  getActiveSessionForWallet,
  getLiveStyleSession,
  putLiveStyleSession,
} from './_live-style-session-store.js'
import { getBearerToken, verifyPrivyAccessToken } from './_wallet-auth.js'
import {
  capPresetToUsdc6,
  LIVE_STYLE_HEARTBEAT_INTERVAL_MS,
} from '../src/features/live-style/lib/config.ts'
import {
  createLiveStyleSession,
  heartbeatLiveStyleSession,
  markMeterStarted,
  stopLiveStyleSession,
} from '../src/features/live-style/lib/session-broker.ts'
import type { LiveStyleSpendAuthMethod } from '../src/features/live-style/lib/payment/types.ts'

type Action = 'create' | 'heartbeat' | 'stop' | 'meter_start'

function parseAuthMethod(value: unknown): LiveStyleSpendAuthMethod {
  if (value === 'coinbase-spend-permission' || value === 'permit2' || value === 'erc20-approve') {
    return value
  }
  return 'erc20-approve'
}

export async function POST(request: Request): Promise<Response> {
  if (!isLiveStyleEnabled()) {
    return Response.json({ error: 'feature_disabled' }, { status: 404 })
  }

  let body: Record<string, unknown>
  try {
    const parsed = await request.json()
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return Response.json({ error: 'invalid body' }, { status: 400 })
    }
    body = parsed as Record<string, unknown>
  } catch {
    return Response.json({ error: 'invalid body' }, { status: 400 })
  }

  const action = body.action as Action
  if (action !== 'create' && action !== 'heartbeat' && action !== 'stop' && action !== 'meter_start') {
    return Response.json({ error: 'invalid action' }, { status: 400 })
  }

  const token = getBearerToken(request) || (typeof body.token === 'string' ? body.token : null)
  if (!token) {
    return Response.json({ error: 'missing authorization' }, { status: 401 })
  }

  const auth = await verifyPrivyAccessToken(
    token,
    typeof body.walletAddress === 'string' ? body.walletAddress : undefined,
  )
  if (!auth) {
    return Response.json({ error: 'invalid authorization' }, { status: 401 })
  }

  const ledger = getLiveStylePaymentLedger()
  const env = { providerUrl: getLiveStyleProviderUrl() }
  const nowMs = Date.now()

  if (action === 'create') {
    const capPreset = parseCapPresetUsd(body.capPresetUsd)
    if (!capPreset) {
      return Response.json({ error: 'invalid capPresetUsd' }, { status: 400 })
    }
    if (getActiveSessionForWallet(auth.address)) {
      return Response.json({ error: 'session_already_active' }, { status: 409 })
    }

    const proof = typeof body.spendAuthProof === 'string' ? body.spendAuthProof : ''
    if (!proof) {
      return Response.json({ error: 'spend_auth_required' }, { status: 400 })
    }

    const isPremium = await isPremiumWallet(auth.address)
    const providerId = parseProviderId(body.providerId)
    const created = await createLiveStyleSession({
      wallet: auth.address,
      providerId,
      capPresetUsd: capPreset,
      isPremium,
      prompt: typeof body.prompt === 'string' ? body.prompt : undefined,
      stylePreset: typeof body.stylePreset === 'string' ? body.stylePreset : undefined,
      nowMs,
      env,
    })

    const capUsdc6 = capPresetToUsdc6(capPreset)
    await ledger.recordAuthorization({
      sessionId: created.session.sessionId,
      wallet: auth.address,
      capUsdc6,
      method: parseAuthMethod(body.spendAuthMethod),
      proof,
      createdAtMs: nowMs,
    })

    putLiveStyleSession(created.session)

    return Response.json({
      sessionId: created.session.sessionId,
      connect: created.connect,
      maxBillableSeconds: created.maxBillableSeconds,
      heartbeatIntervalMs: LIVE_STYLE_HEARTBEAT_INTERVAL_MS,
      capUsdc6,
      isPremium,
      paymentSpender: getLiveStylePaymentSpender() ?? null,
      envPlaceholders: {
        LIVE_STYLE_PROVIDER_URL: 'set for StreamDiffusion host',
        LIVE_STYLE_PROVIDER_KEY: 'provider auth',
        LIVE_STYLE_PAYMENT_SPENDER: 'on-chain pull spender',
      },
    })
  }

  const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
  const session = getLiveStyleSession(sessionId)
  if (!session || session.wallet !== auth.address.toLowerCase()) {
    return Response.json({ error: 'session_not_found' }, { status: 404 })
  }

  if (action === 'meter_start') {
    const updated = markMeterStarted(session, nowMs)
    putLiveStyleSession(updated)
    return Response.json({ ok: true, meterStarted: true })
  }

  if (action === 'heartbeat') {
    const result = await heartbeatLiveStyleSession(session, ledger, nowMs)
    putLiveStyleSession(result.session)
    if (result.shouldStop) {
      await stopLiveStyleSession(result.session, ledger, result.session.metering.stopReason ?? 'stop', env)
      deleteLiveStyleSession(sessionId)
    }
    return Response.json({
      ok: true,
      events: result.events,
      billedSeconds: result.session.metering.billedSeconds,
      pulledUsdc6: result.session.metering.pulledUsdc6,
      shouldStop: result.shouldStop,
    })
  }

  const stopped = await stopLiveStyleSession(session, ledger, 'user_stop', env)
  deleteLiveStyleSession(sessionId)
  return Response.json({
    ok: true,
    billedSeconds: stopped.metering.billedSeconds,
    pulledUsdc6: stopped.metering.pulledUsdc6,
  })
}
