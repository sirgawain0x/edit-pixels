import { describe, expect, it, vi } from 'vitest'
import { UPLOAD_SESSION_PATH, uploadParts, type UploadPartInput } from './upload-parts'

const JOB = 'job-1'

function part(name: string, bytes = 8): UploadPartInput {
  return { name, contentType: 'audio/wav', blob: new Blob([new Uint8Array(bytes)]) }
}

function sessionBody(files: Array<{ name: string; sessionUri: string }>) {
  return {
    jobId: JOB,
    files: files.map((file) => ({
      name: file.name,
      uri: `gs://creative-pixels-transcribe-batch/input/0xabc/${JOB}/${file.name}`,
      sessionUri: file.sessionUri,
    })),
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('uploadParts', () => {
  it('authenticates the session request but not the pre-signed PUTs', async () => {
    // `/api/transcribe-upload-session` runs the same identity check as the quote. The PUT below it
    // must stay bare: the GCS signature *is* the credential, and an unexpected Authorization header
    // is rejected.
    const { registerPrecisionAccessToken } = await import('./precision-auth')
    const unregister = registerPrecisionAccessToken(async () => 'privy-token')
    try {
      const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
        if (url === UPLOAD_SESSION_PATH) {
          return jsonResponse(
            sessionBody([{ name: 'part-0.wav', sessionUri: 'https://storage.googleapis.com/s/0' }]),
          )
        }
        expect(init?.method).toBe('PUT')
        return new Response(null, { status: 200 })
      })

      await uploadParts({
        jobId: JOB,
        parts: [part('part-0.wav')],
        fetchImpl: fetchImpl as unknown as typeof fetch,
      })

      const sessionHeaders = (fetchImpl.mock.calls[0]?.[1] as RequestInit).headers as Record<
        string,
        string
      >
      expect(sessionHeaders.authorization).toBe('Bearer privy-token')

      const putHeaders = (fetchImpl.mock.calls[1]?.[1] as RequestInit).headers as Record<
        string,
        string
      >
      expect(putHeaders.authorization).toBeUndefined()
    } finally {
      unregister()
    }
  })

  it('asks for sessions, then PUTs each part to its own session URL', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === UPLOAD_SESSION_PATH) {
        return jsonResponse(
          sessionBody([
            { name: 'part-0.wav', sessionUri: 'https://storage.googleapis.com/s/0' },
            { name: 'part-1.wav', sessionUri: 'https://storage.googleapis.com/s/1' },
          ]),
        )
      }
      expect(init?.method).toBe('PUT')
      return new Response(null, { status: 200 })
    })

    const uploaded = await uploadParts({
      jobId: JOB,
      parts: [part('part-0.wav'), part('part-1.wav')],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    expect(uploaded).toEqual([
      {
        name: 'part-0.wav',
        uri: `gs://creative-pixels-transcribe-batch/input/0xabc/${JOB}/part-0.wav`,
      },
      {
        name: 'part-1.wav',
        uri: `gs://creative-pixels-transcribe-batch/input/0xabc/${JOB}/part-1.wav`,
      },
    ])

    const sessionCall = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(String(sessionCall[1].body))).toEqual({
      jobId: JOB,
      files: [
        { name: 'part-0.wav', contentType: 'audio/wav' },
        { name: 'part-1.wav', contentType: 'audio/wav' },
      ],
    })
  })

  it('never sends an Authorization header to storage.googleapis.com', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === UPLOAD_SESSION_PATH) {
        return jsonResponse(
          sessionBody([{ name: 'part-0.wav', sessionUri: 'https://storage.googleapis.com/s/0' }]),
        )
      }
      return new Response(null, { status: 200 })
    })

    await uploadParts({
      jobId: JOB,
      parts: [part('part-0.wav')],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    const putCall = fetchImpl.mock.calls[1] as unknown as [string, RequestInit]
    expect(putCall[1].headers).toEqual({ 'Content-Type': 'audio/wav' })
    expect(JSON.stringify(putCall[1].headers)).not.toContain('Authorization')
  })

  it('matches sessions by name, not by array order', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === UPLOAD_SESSION_PATH) {
        // Server builds sessions with Promise.all, so order is not guaranteed.
        return jsonResponse(
          sessionBody([
            { name: 'part-1.wav', sessionUri: 'https://storage.googleapis.com/s/1' },
            { name: 'part-0.wav', sessionUri: 'https://storage.googleapis.com/s/0' },
          ]),
        )
      }
      return new Response(null, { status: 200 })
    })

    await uploadParts({
      jobId: JOB,
      parts: [part('part-0.wav'), part('part-1.wav')],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    // part-0 must be PUT to the session the server issued for part-0.
    const firstPut = fetchImpl.mock.calls[1] as unknown as [string]
    expect(firstPut[0]).toBe('https://storage.googleapis.com/s/0')
  })

  it('reports progress once per finished part', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === UPLOAD_SESSION_PATH) {
        return jsonResponse(
          sessionBody([
            { name: 'part-0.wav', sessionUri: 'https://storage.googleapis.com/s/0' },
            { name: 'part-1.wav', sessionUri: 'https://storage.googleapis.com/s/1' },
          ]),
        )
      }
      return new Response(null, { status: 200 })
    })
    const onProgress = vi.fn()

    await uploadParts({
      jobId: JOB,
      parts: [part('part-0.wav'), part('part-1.wav')],
      fetchImpl: fetchImpl as unknown as typeof fetch,
      onProgress,
    })

    expect(onProgress.mock.calls.map((call) => call[0])).toEqual([
      { completed: 1, total: 2, name: 'part-0.wav' },
      { completed: 2, total: 2, name: 'part-1.wav' },
    ])
  })

  it('surfaces a refused session with its status', async () => {
    const fetchImpl = vi.fn(async () => new Response('job_not_uploadable', { status: 409 }))

    await expect(
      uploadParts({
        jobId: JOB,
        parts: [part('part-0.wav')],
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/upload session refused \(409\).*job_not_uploadable/)
  })

  it('explains a 412 as an already-uploaded part', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === UPLOAD_SESSION_PATH) {
        return jsonResponse(
          sessionBody([{ name: 'part-0.wav', sessionUri: 'https://storage.googleapis.com/s/0' }]),
        )
      }
      return new Response('precondition', { status: 412 })
    })

    await expect(
      uploadParts({
        jobId: JOB,
        parts: [part('part-0.wav')],
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/upload rejected for part-0\.wav \(412\)/)
  })

  it('fails when the server issues no session for a requested part', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === UPLOAD_SESSION_PATH) {
        return jsonResponse(
          sessionBody([{ name: 'part-9.wav', sessionUri: 'https://storage.googleapis.com/s/9' }]),
        )
      }
      return new Response(null, { status: 200 })
    })

    await expect(
      uploadParts({
        jobId: JOB,
        parts: [part('part-0.wav')],
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/no upload session issued for part-0\.wav/)
  })

  it('does nothing for an empty part list', async () => {
    const fetchImpl = vi.fn()
    expect(
      await uploadParts({ jobId: JOB, parts: [], fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).toEqual([])
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
