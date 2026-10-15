import { describe, expect, it } from 'vitest'
import { DIRECTOR_SESSION_PACKS } from '@/config/credits'
import { estimateDirectorPackMinutes } from '@/config/director-pack-minutes'

describe('estimateDirectorPackMinutes', () => {
  it('matches billing rates for Brief, Session, and Production packs', () => {
    expect(DIRECTOR_SESSION_PACKS).toHaveLength(3)
    const brief = DIRECTOR_SESSION_PACKS[0]!
    const session = DIRECTOR_SESSION_PACKS[1]!
    const production = DIRECTOR_SESSION_PACKS[2]!

    expect(estimateDirectorPackMinutes(brief.usdc6)).toEqual({
      retailMinutes: 100,
      premiumMinutes: 200,
    })
    expect(estimateDirectorPackMinutes(session.usdc6)).toEqual({
      retailMinutes: 300,
      premiumMinutes: 600,
    })
    expect(estimateDirectorPackMinutes(production.usdc6)).toEqual({
      retailMinutes: 800,
      premiumMinutes: 1600,
    })
  })
})
