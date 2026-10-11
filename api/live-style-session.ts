/**
 * POST /api/live-style-session — create, heartbeat, stop Live Style sessions.
 */
// fallow-ignore-file complexity,duplicate-export

import { authorizeFeatureGatedPrivyPost } from './_feature-gated-privy-post.js'
import { isPremiumWallet } from './_premium-membership.js'
import {
  getLiveStylePaymentSpender,
  getLiveStyleProviderUrl,
  getLiveStyleWsTokenSecret,
  isLiveStyleEnabled,
  parseCapPresetUsd,
  parseProviderId,
} from './_live-style-config.js'
import {
  isLiveStyleSpendAuthEnforced,
  verifyAndConsumeLiveStyleSpendAuth,
} from './_live-style-spend-auth-verify.js'
import { getLiveStylePaymentLedger } from './_live-style-payment-server.js'
import { runLiveStyleSessionSweep } from './_live-style-sweep.js'
import {
  deleteLiveStyleSession,
  getActiveSessionForWallet,
  getLiveStyleSession,
  putLiveStyleSession,
} from './_live-style-session-store.js'
import {
  capPresetToUsdc6,
  LIVE_STYLE_HEARTBEAT_INTERVAL_MS,
  LIVE_STYLE_MAX_SESSION_SECONDS,
} from '../src/features/live-style/lib/config.ts'
import { checkLiveStyleProductionPaymentConfig } from '../src/features/live-style/lib/live-style-production-guard.ts'
import { signLiveStyleWsToken } from '../src/features/live-style/lib/ws-session-token.ts'
import { sessionAfterStoppingHeartbeat } from '../src/features/live-style/lib/heartbeat-stop.ts'
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

function parseAction(value: unknown): Action | null {
  if (value === 'create' || value === 'heartbeat' || value === 'stop' || value === 'meter_start') {
    return value
  }
  return null
}

export async function POST(request: Request): Promise<Response> {
  const authorized = await authorizeFeatureGatedPrivyPost(request, isLiveStyleEnabled)
  if (!authorized.ok) return authorized.response

  const { auth, body } = authorized
  const action = parseAction(body.action)
  if (!action) {
    return Response.json({ error: 'invalid action' }, { status: 400 })
  }

  const ledger = getLiveStylePaymentLedger()
  const env = { providerUrl: getLiveStyleProviderUrl() }
  const nowMs = Date.now()

  await runLiveStyleSessionSweep(nowMs)

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

    const productionConfig = checkLiveStyleProductionPaymentConfig()
    if (!productionConfig.ok) {
      console.error('[live-style] production payment config refused:', productionConfig.reason)
      return Response.json(
        { error: productionConfig.error, reason: productionConfig.reason },
        { status: 503 },
      )
    }

    const capUsdc6 = capPresetToUsdc6(capPreset)
    const authMethod = parseAuthMethod(body.spendAuthMethod)

    if (isLiveStyleSpendAuthEnforced()) {
      const verified = await verifyAndConsumeLiveStyleSpendAuth({
        proof,
        method: authMethod,
        wallet: auth.address,
        capUsdc6,
        nowMs,
      })
      if (!verified.ok) {
        return Response.json({ error: 'spend_auth_invalid', reason: verified.reason }, { status: 400 })
      }
    }

    const wsSecret = getLiveStyleWsTokenSecret()
    if (!wsSecret) {
      return Response.json({ error: 'live_style_ws_token_secret_not_configured' }, { status: 503 })
    }

    const expMs = nowMs + LIVE_STYLE_MAX_SESSION_SECONDS * 1000 + 60_000
    const wallet = auth.address

    const isPremium = await isPremiumWallet(auth.address)
    const providerId = parseProviderId(body.providerId)
    const created = await createLiveStyleSession({
      wallet,
      providerId,
      capPresetUsd: capPreset,
      isPremium,
      prompt: typeof body.prompt === 'string' ? body.prompt : undefined,
      stylePreset: typeof body.stylePreset === 'string' ? body.stylePreset : undefined,
      nowMs,
      env: { ...env, wsTokenSecret: wsSecret },
      buildWsToken: (sessionId) =>
        signLiveStyleWsToken({ sessionId, wallet, expMs }, wsSecret),
    })

    await ledger.recordAuthorization({
      sessionId: created.session.sessionId,
      wallet: auth.address,
      capUsdc6,
      method: authMethod,
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
    const result = await heartbeatLiveStyleSession(session, ledger, nowMs, env)
    putLiveStyleSession(result.session)
    let responseSession = result.session
    if (result.shouldStop) {
      try {
        responseSession = await sessionAfterStoppingHeartbeat(result, ledger, env)
      } finally {
        deleteLiveStyleSession(sessionId)
      }
    }
    return Response.json({
      ok: true,
      events: result.events,
      billedSeconds: responseSession.metering.billedSeconds,
      pulledUsdc6: responseSession.metering.pulledUsdc6,
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
