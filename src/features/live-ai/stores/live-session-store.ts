import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ScopeSessionData } from '../types';

export interface RecordedTake {
  blob: Blob;
  durationMs: number;
  linkedTimelineStart: number;
}

export interface LiveSessionState {
  isOpen: boolean;
  isRecording: boolean;
  includeTimelineAudio: boolean;
  /** When true, recordings are inserted on the timeline automatically after stop. */
  autoAddToTimeline: boolean;
  permissionsGranted: boolean;
  recordedTakes: RecordedTake[];
  popoverPosition: { x: number; y: number };
  /** True while broadcast is live (Superfluid streaming billing). */
  streamActive: boolean;
  /** Current stream id (Daydream/Livepeer) when streamActive. */
  streamId: string | null;
  /** Set when Superfluid billing fails; UI shows top-up USDC. */
  billingError:
    | 'insufficient_balance'
    | 'session_limit_exceeded'
    | 'rpc_or_unknown'
    | 'wallet_not_ready'
    | null;
  /** Underlying error detail for rpc_or_unknown (UserOp, RPC, tx failure). */
  billingErrorDetail: string | null;

  // Scope local server state
  /** Whether Scope server is reachable on localhost. */
  scopeConnected: boolean;
  /** Active Scope WebRTC session ID. */
  scopeSessionId: string | null;
  /** Currently loaded pipeline on Scope. */
  scopePipeline: string | null;
  /** Hardware info from Scope server (VRAM in GB, Spout availability). */
  scopeHardwareInfo: { vram: number; spout: boolean } | null;
  /** True while a pipeline is loading/swapping on Scope. */
  pipelineLoading: boolean;
  /** Reference to the active Scope session (WebRTC resources). Not serialized. */
  scopeSession: ScopeSessionData | null;
}

export interface LiveSessionActions {
  setOpen: (open: boolean) => void;
  setRecording: (recording: boolean) => void;
  setIncludeTimelineAudio: (include: boolean) => void;
  setAutoAddToTimeline: (enabled: boolean) => void;
  setPermissionsGranted: (granted: boolean) => void;
  addRecordedTake: (take: RecordedTake) => void;
  removeLastRecordedTake: () => void;
  clearRecordedTakes: () => void;
  setPopoverPosition: (position: { x: number; y: number }) => void;
  toggleOpen: () => void;
  setStreamActive: (active: boolean) => void;
  setStreamId: (id: string | null) => void;
  setBillingError: (
    error: LiveSessionState['billingError'],
    detail?: string | null
  ) => void;
  clearBillingError: () => void;

  // Scope actions
  setScopeConnected: (connected: boolean) => void;
  setScopeSessionId: (id: string | null) => void;
  setScopePipeline: (pipeline: string | null) => void;
  setScopeHardwareInfo: (info: { vram: number; spout: boolean } | null) => void;
  setPipelineLoading: (loading: boolean) => void;
  setScopeSession: (session: ScopeSessionData | null) => void;
}

const DEFAULT_POSITION = { x: 0, y: 0 };

export const useLiveSessionStore = create<LiveSessionState & LiveSessionActions>()(
  persist(
    (set) => ({
      isOpen: false,
      isRecording: false,
      includeTimelineAudio: false,
      autoAddToTimeline: true,
      permissionsGranted: false,
      recordedTakes: [],
      popoverPosition: DEFAULT_POSITION,
      streamActive: false,
      streamId: null,
      billingError: null,
      billingErrorDetail: null,

      // Scope defaults
      scopeConnected: false,
      scopeSessionId: null,
      scopePipeline: null,
      scopeHardwareInfo: null,
      pipelineLoading: false,
      scopeSession: null,

      setOpen: (open) => set({ isOpen: open }),
      setRecording: (recording) => set({ isRecording: recording }),
      setIncludeTimelineAudio: (include) => set({ includeTimelineAudio: include }),
      setAutoAddToTimeline: (enabled) => set({ autoAddToTimeline: enabled }),
      setPermissionsGranted: (granted) => set({ permissionsGranted: granted }),
      addRecordedTake: (take) =>
        set((state) => ({ recordedTakes: [...state.recordedTakes, take] })),
      removeLastRecordedTake: () =>
        set((state) => ({
          recordedTakes:
            state.recordedTakes.length > 0
              ? state.recordedTakes.slice(0, -1)
              : state.recordedTakes,
        })),
      clearRecordedTakes: () => set({ recordedTakes: [] }),
      setPopoverPosition: (position) => set({ popoverPosition: position }),
      toggleOpen: () => set((state) => ({ isOpen: !state.isOpen })),
      setStreamActive: (active) => set({ streamActive: active }),
      setStreamId: (id) => set({ streamId: id }),
      setBillingError: (error, detail) =>
        set({
          billingError: error,
          billingErrorDetail: error === null ? null : (detail ?? null),
        }),
      clearBillingError: () => set({ billingError: null, billingErrorDetail: null }),

      // Scope actions
      setScopeConnected: (connected) => set({ scopeConnected: connected }),
      setScopeSessionId: (id) => set({ scopeSessionId: id }),
      setScopePipeline: (pipeline) => set({ scopePipeline: pipeline }),
      setScopeHardwareInfo: (info) => set({ scopeHardwareInfo: info }),
      setPipelineLoading: (loading) => set({ pipelineLoading: loading }),
      setScopeSession: (session) => set({ scopeSession: session }),
    }),
    {
      name: 'live-ai-session',
      partialize: (state) => ({ autoAddToTimeline: state.autoAddToTimeline }),
    },
  ),
);
