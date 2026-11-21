import { beforeEach, describe, expect, it, vi } from 'vitest'

const rest = vi.hoisted(() => ({
  getFirestoreDocument: vi.fn(),
  runFirestoreStructuredQuery: vi.fn(),
  deleteFirestoreDocument: vi.fn(),
  createFirestoreDocument: vi.fn(),
  patchFirestoreDocument: vi.fn(),
}))

vi.mock('../../../../api/_firestore-rest.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../api/_firestore-rest.js')>()
  return {
    ...actual,
    isDirectorFirestoreEnabled: () => true,
    getFirestoreDocument: rest.getFirestoreDocument,
    runFirestoreStructuredQuery: rest.runFirestoreStructuredQuery,
    deleteFirestoreDocument: rest.deleteFirestoreDocument,
    createFirestoreDocument: rest.createFirestoreDocument,
    patchFirestoreDocument: rest.patchFirestoreDocument,
  }
})

import {
  deleteDirectorSession,
  getDirectorSessionTranscript,
  listDirectorSessions,
} from '../../../../api/_director-firestore.js'

const WALLET = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const s = (value: string) => ({ stringValue: value })

function sessionDoc(wallet: string) {
  return {
    name: 'projects/p/databases/d/documents/director_sessions/sess-1',
    fields: {
      wallet: s(wallet),
      promptPreview: s('Storyboard this track'),
      status: s('completed'),
    },
  }
}

function turn(id: string, role: string, content: string, seq: number) {
  return {
    name: `projects/p/databases/d/documents/director_turns/${id}`,
    fields: { role: s(role), content: s(content), seq: { integerValue: String(seq) } },
  }
}

describe('director Firestore session history', () => {
  beforeEach(() => {
    for (const fn of Object.values(rest)) fn.mockReset()
    rest.deleteFirestoreDocument.mockResolvedValue(true)
  })

  it('returns turns in order for the owning wallet', async () => {
    rest.getFirestoreDocument.mockResolvedValue(sessionDoc(WALLET))
    rest.runFirestoreStructuredQuery.mockResolvedValueOnce([
      turn('t2', 'assistant', 'Here is your storyboard', 2),
      turn('t1', 'user', 'Storyboard this track', 1),
      turn('t3', 'user', 'Make scene 2 darker', 3),
    ])

    const transcript = await getDirectorSessionTranscript({
      walletAddress: WALLET.toUpperCase().replace('0X', '0x'),
      sessionId: 'sess-1',
    })

    expect(transcript?.source).toBe('turns')
    expect(transcript?.messages.map((m) => `${m.role}:${m.content}`)).toEqual([
      'user:Storyboard this track',
      'assistant:Here is your storyboard',
      'user:Make scene 2 darker',
    ])
  })

  it('hides sessions owned by another wallet', async () => {
    rest.getFirestoreDocument.mockResolvedValue(
      sessionDoc('0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'),
    )
    expect(await getDirectorSessionTranscript({ walletAddress: WALLET, sessionId: 'sess-1' })).toBe(
      null,
    )
    expect(await deleteDirectorSession({ walletAddress: WALLET, sessionId: 'sess-1' })).toBe(
      'not_found',
    )
    expect(rest.deleteFirestoreDocument).not.toHaveBeenCalled()
  })

  it('falls back to saved storyboards for legacy sessions', async () => {
    rest.getFirestoreDocument.mockResolvedValue(sessionDoc(WALLET))
    rest.runFirestoreStructuredQuery.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        name: 'x/director_storyboards/sb1',
        fields: {
          markdown: s('## Storyboard'),
          createdAt: { timestampValue: '2026-01-01T00:00:00Z' },
        },
      },
    ])

    const transcript = await getDirectorSessionTranscript({
      walletAddress: WALLET,
      sessionId: 'sess-1',
    })
    expect(transcript?.source).toBe('storyboards')
    expect(transcript?.messages.map((m) => m.role)).toEqual(['user', 'assistant'])
  })

  it('deletes the session, its turns, and storyboards', async () => {
    rest.getFirestoreDocument.mockResolvedValue(sessionDoc(WALLET))
    rest.runFirestoreStructuredQuery
      .mockResolvedValueOnce([turn('t1', 'user', 'hi', 1)])
      .mockResolvedValueOnce([{ name: 'x/director_storyboards/sb1', fields: {} }])

    expect(await deleteDirectorSession({ walletAddress: WALLET, sessionId: 'sess-1' })).toBe(
      'deleted',
    )
    const deleted = rest.deleteFirestoreDocument.mock.calls.map(
      ([arg]) => `${arg.collection}/${arg.documentId}`,
    )
    expect(deleted).toEqual(
      expect.arrayContaining([
        'director_turns/t1',
        'director_storyboards/sb1',
        'director_sessions/sess-1',
      ]),
    )
  })

  it('omits pending placeholder sessions from the list', async () => {
    rest.runFirestoreStructuredQuery.mockResolvedValue([
      { name: 'x/director_sessions/pending-0xabc', fields: { promptPreview: s('a') } },
      { name: 'x/director_sessions/real-1', fields: { promptPreview: s('b') } },
    ])
    const rows = await listDirectorSessions({ walletAddress: WALLET })
    expect(rows.map((row) => row.sessionId)).toEqual(['real-1'])
  })
})
