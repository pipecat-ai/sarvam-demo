"use client"

import type {
  LLMFunctionCallInProgressData,
  LLMFunctionCallStartedData,
  LLMFunctionCallStoppedData,
  PipecatClient,
} from "@pipecat-ai/client-js"
import { RTVIEvent } from "@pipecat-ai/client-js"
import { usePipecatClient } from "@pipecat-ai/client-react"
import { useEffect, useRef, useState } from "react"
import { create } from "zustand"

/** The most recent tool call, as the bot reported it. */
export interface ToolCall {
  name: string
  toolCallId: string | null
  arguments: Record<string, unknown> | null
  /** Set when the call finished; undefined while it runs. */
  result?: unknown
  cancelled: boolean
}

interface ToolCallsState {
  /** Per-session call count, keyed by function name. */
  counts: Record<string, number>
  /** The latest call, with its arguments and (once done) its result. */
  last: ToolCall | null
  started: (name: string) => void
  inProgress: (data: LLMFunctionCallInProgressData) => void
  stopped: (data: LLMFunctionCallStoppedData) => void
  /** Clears everything (called when a new session connects). */
  reset: () => void
}

/**
 * Module-level store of this session's tool calls (after bland-demo's): counts
 * per function, flashed by the panel, and the latest call's arguments and
 * result. One listener per client feeds it; any number of components
 * subscribe. Resets when a new session connects.
 *
 * Driven by the server's `llm-function-call-*` events, so the bot's RTVI
 * observer reports calls in full (`RTVIFunctionCallReportLevel.FULL` in
 * server/bot.py); nameless events are ignored.
 */
export const useToolCallsStore = create<ToolCallsState>()((set) => ({
  counts: {},
  last: null,
  started: (name) =>
    set((state) => ({
      counts: { ...state.counts, [name]: (state.counts[name] ?? 0) + 1 },
      last: { name, toolCallId: null, arguments: null, cancelled: false },
    })),
  inProgress: (data) =>
    set((state) => {
      const name = data.function_name ?? state.last?.name
      if (!name) return state
      return {
        last: {
          name,
          toolCallId: data.tool_call_id,
          arguments: data.arguments ?? null,
          cancelled: false,
        },
      }
    }),
  stopped: (data) =>
    set((state) => {
      if (!state.last || state.last.toolCallId !== data.tool_call_id)
        return state
      return {
        last: { ...state.last, result: data.result, cancelled: data.cancelled },
      }
    }),
  reset: () => set({ counts: {}, last: null }),
}))

// ---------------------------------------------------------------------------
// The chime: a short two-note blip from Web Audio, under the bot's voice
// rather than over it. Synthesised so there is no audio file to ship (the
// repo ignores *.wav).
// ---------------------------------------------------------------------------

let chimeContext: AudioContext | null = null

function playChime() {
  try {
    chimeContext ??= new AudioContext()
    const ctx = chimeContext
    const start = ctx.currentTime
    for (const [offset, frequency] of [
      [0, 880],
      [0.09, 1320],
    ] as const) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = "sine"
      osc.frequency.value = frequency
      gain.gain.setValueAtTime(0.0001, start + offset)
      gain.gain.exponentialRampToValueAtTime(0.12, start + offset + 0.01)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.18)
      osc.connect(gain).connect(ctx.destination)
      osc.start(start + offset)
      osc.stop(start + offset + 0.2)
    }
  } catch {
    // No audio (blocked or unsupported): the counters still tell the story.
  }
}

// ---------------------------------------------------------------------------
// Listener attachment: ref-counted per client so any number of subscribers
// share one RTVI listener, attached by the first and detached by the last.
// ---------------------------------------------------------------------------

const listenerRefCounts = new Map<PipecatClient, number>()

function handleStarted(data: LLMFunctionCallStartedData) {
  if (!data.function_name) return
  useToolCallsStore.getState().started(data.function_name)
  playChime()
}

function handleInProgress(data: LLMFunctionCallInProgressData) {
  useToolCallsStore.getState().inProgress(data)
}

function handleStopped(data: LLMFunctionCallStoppedData) {
  useToolCallsStore.getState().stopped(data)
}

function handleConnected() {
  useToolCallsStore.getState().reset()
}

function attachListeners(client: PipecatClient) {
  const count = listenerRefCounts.get(client) ?? 0
  listenerRefCounts.set(client, count + 1)
  if (count > 0) return
  client.on(RTVIEvent.LLMFunctionCallStarted, handleStarted)
  client.on(RTVIEvent.LLMFunctionCallInProgress, handleInProgress)
  client.on(RTVIEvent.LLMFunctionCallStopped, handleStopped)
  client.on(RTVIEvent.Connected, handleConnected)
}

function detachListeners(client: PipecatClient) {
  const count = listenerRefCounts.get(client) ?? 0
  if (count <= 1) {
    listenerRefCounts.delete(client)
    client.off(RTVIEvent.LLMFunctionCallStarted, handleStarted)
    client.off(RTVIEvent.LLMFunctionCallInProgress, handleInProgress)
    client.off(RTVIEvent.LLMFunctionCallStopped, handleStopped)
    client.off(RTVIEvent.Connected, handleConnected)
    return
  }
  listenerRefCounts.set(client, count - 1)
}

/** Shared by every public hook: feed the store from the context client. */
function useAttachToolCallListeners() {
  const client = usePipecatClient()
  useEffect(() => {
    if (!client) return
    attachListeners(client)
    return () => detachListeners(client)
  }, [client])
}

// ---------------------------------------------------------------------------
// Public hooks
// ---------------------------------------------------------------------------

/** Total tool calls this session. Must be rendered inside a PipecatClientProvider. */
export function useToolCallTotal(): number {
  useAttachToolCallListeners()
  return useToolCallsStore((state) =>
    Object.values(state.counts).reduce((sum, n) => sum + n, 0)
  )
}

/** The latest tool call. Must be rendered inside a PipecatClientProvider. */
export function useLastToolCall(): ToolCall | null {
  useAttachToolCallListeners()
  return useToolCallsStore((state) => state.last)
}

export interface UseToolCallFlashReturn {
  /** Calls of this tool so far this session. */
  count: number
  /** True for `durationMs` after each new call — drive the highlight with it. */
  flashing: boolean
}

/**
 * Session call count for `name` plus a momentary `flashing` pulse on each
 * new call. Only increments flash, so the reset at the start of a session
 * stays silent. Must be rendered inside a PipecatClientProvider.
 */
export function useToolCallFlash(
  name: string,
  durationMs = 600
): UseToolCallFlashReturn {
  useAttachToolCallListeners()
  const count = useToolCallsStore((state) => state.counts[name] ?? 0)
  const [flashing, setFlashing] = useState(false)
  const previousCount = useRef(count)

  useEffect(() => {
    const increased = count > previousCount.current
    previousCount.current = count
    if (!increased) return
    setFlashing(true)
    // Restarts on a rapid second call, so back-to-back calls read as one
    // sustained highlight rather than a dropped flash.
    const timer = setTimeout(() => setFlashing(false), durationMs)
    return () => clearTimeout(timer)
  }, [count, durationMs])

  return { count, flashing }
}
