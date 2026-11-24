import { vi } from 'vite-plus/test'
import {
  ADD_OBJECT_URL,
  REMOVE_OBJECT_URL,
  SYNC_OBJECT_URL_REGISTRY,
} from './object-url-registry'

export type PostedMessage = { type: string; [key: string]: unknown }

export function registryBroadcastPayloads(): Array<Record<string, unknown>> {
  return [
    {
      type: SYNC_OBJECT_URL_REGISTRY,
      entries: [{ url: 'blob:reg', blob: new Blob(['reg']) }],
    },
    { type: ADD_OBJECT_URL, url: 'blob:add', blob: new Blob(['add']) },
    { type: REMOVE_OBJECT_URL, url: 'blob:remove' },
  ]
}

export function stubWorkerShell() {
  const posted: PostedMessage[] = []
  const messageListeners: Array<(event: MessageEvent) => void> = []
  vi.stubGlobal('self', {
    postMessage: vi.fn((message: PostedMessage) => {
      posted.push(message)
    }),
    onmessage: null as ((event: MessageEvent) => void | Promise<void>) | null,
    addEventListener: vi.fn((type: string, listener: (event: MessageEvent) => void) => {
      if (type === 'message') messageListeners.push(listener)
    }),
    removeEventListener: vi.fn(),
    dispatchMessage(event: MessageEvent) {
      for (const listener of messageListeners) listener(event)
    },
  })
  return posted
}

export function hasErrorResponse(posted: PostedMessage[]): boolean {
  return posted.some((message) => message.type === 'error')
}

export async function dispatchRegistryPayloads(
  onmessage: (event: MessageEvent) => void | Promise<void>,
): Promise<void> {
  for (const payload of registryBroadcastPayloads()) {
    await onmessage({ data: payload } as MessageEvent)
  }
}

export async function expectRegistryIgnoredBeforeJob(
  loadWorker: () => Promise<unknown>,
  runControlMessage: (onmessage: (event: MessageEvent) => void | Promise<void>) => Promise<void>,
): Promise<void> {
  const posted = stubWorkerShell()
  await loadWorker()
  const onmessage = (self as unknown as { onmessage: (event: MessageEvent) => void }).onmessage
  expect(onmessage).toBeTypeOf('function')
  await dispatchRegistryPayloads(onmessage)
  expect(hasErrorResponse(posted)).toBe(false)
  await runControlMessage(onmessage)
}