import type { TransportState } from "@pipecat-ai/client-js"
import {
  PipecatClientAudio,
  PipecatClientProvider,
  usePipecatClientTransportState,
} from "@pipecat-ai/client-react"
import { createStore } from "jotai"
import { useState } from "react"

import { AudioVisualizerBar } from "@/components/pipecat/audio-visualizer-bar"
import { AudioVisualizerWave } from "@/components/pipecat/audio-visualizer-wave"
import { ConnectButton } from "@/components/pipecat/connect-button"
import { Conversation } from "@/components/pipecat/conversation"
import { Panel } from "@/components/pipecat/panel"
import { TextInput } from "@/components/pipecat/text-input"
import { MetricsPanel } from "@/components/app/metrics-panel"
import { MicBar } from "@/components/app/mic-bar"
import { ToolCallsPanel } from "@/components/app/tool-calls-panel"
import { Tray } from "@/components/app/tray"
import { useMediaQuery } from "@/hooks/use-media-query"
import { usePipecatApp } from "@/hooks/use-pipecat-app"
import { useBotSpeaking, useSessionVersions } from "@/hooks/use-session"
import { useToolCallTotal } from "@/hooks/use-tool-calls"
import { sessionConfig } from "@/lib/session-config"
import { cn } from "@/lib/utils"

/** Two columns from here up; below it the transcript lives in a tray. */
const WIDE_QUERY = "(min-width: 768px)"

/**
 * Retro dither for the agent orb. levels well above the default keeps the
 * quantisation from knocking the dim violet off-hue; alphaLevels 2
 * hard-stipples the edge, so the orb reads as a field of dots. Hoisted
 * because it is compiled into the shader — a fresh object each render
 * would rebuild the WebGL program on every frame.
 */
const ORB_DITHER = { levels: 12, alphaLevels: 2 } as const

// ---------------------------------------------------------------------------
// Session phase
// ---------------------------------------------------------------------------

type Phase = "idle" | "starting" | "live" | "error"

const STARTING_STATES: TransportState[] = [
  "initializing",
  "authenticating",
  "authenticated",
  "connecting",
  "disconnecting",
]
const LIVE_STATES: TransportState[] = ["connected", "ready"]

function phaseOf(transportState: TransportState, error: string | null): Phase {
  if (error || transportState === "error") return "error"
  if (LIVE_STATES.includes(transportState)) return "live"
  if (STARTING_STATES.includes(transportState)) return "starting"
  return "idle"
}

/** Dot and word for a panel's status, printed on its border. */
function SessionStatus({
  phase,
  speaking,
  liveLabel = "ready",
}: {
  phase: Phase
  speaking: boolean
  liveLabel?: string
}) {
  const status = {
    idle: { label: "idle", tone: "text-muted-foreground/60" },
    starting: { label: "connecting", tone: "text-tool" },
    live: { label: speaking ? "speaking" : liveLabel, tone: "text-active" },
    error: { label: "error", tone: "text-inactive" },
  }[phase]

  return (
    <span className="text-muted-foreground">
      <span className={cn("mr-1.5", status.tone)}>●</span>
      {status.label}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Voice Agent: the orb (the bot's voice, drawn) with the transcript beside it
// on wide screens; on a phone the orb, the controls, and the transcript in
// a tray.
// ---------------------------------------------------------------------------

/** The line under the orb: what the session is doing, and what to do next. */
function AgentCaption({
  phase,
  error,
  wide,
}: {
  phase: Phase
  error: string | null
  wide: boolean
}) {
  if (phase === "error") {
    return (
      <p className="px-6 pb-4 text-center text-inactive">
        {error ?? "session failed"}
      </p>
    )
  }
  const [prefix, action] = {
    idle: ["not connected — ", "connect to book a table"],
    starting: ["connecting — ", "setting up the session"],
    live: [
      "connected — ",
      wide
        ? "talk in English, Hindi, or both, or type on the right"
        : "talk in English, Hindi, or both, or type below",
    ],
  }[phase]

  return (
    <p className="px-6 pb-4 text-center">
      <span className="text-muted-foreground/70">{prefix}</span>
      <span className="text-foreground">{action}</span>
    </p>
  )
}

/** The bot's voice as an aura: the shader orb with level bars in its hollow. */
function AgentOrb({ phase, size }: { phase: Phase; size: number }) {
  return (
    // The orb is clipped by this box rather than the panel, so the panel's
    // legends can still hang over its border.
    <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden">
      <AudioVisualizerWave
        participantType="bot"
        size={size}
        isConnecting={phase === "starting"}
        // Two fixed tones, held: accentColor pins the pair (so speech can't
        // widen the hue range), and a colorShift this high interleaves them
        // layer by layer — the palette reads as one steady violet-into-blue
        // rather than a cycle through it.
        color="--agent"
        accentColor="--client"
        colorShift={0.4}
        // A calm, even stipple: no specular blob over the hollow, a rounder
        // edge, and dim enough that the dither reads as a dot field rather
        // than a solid mass.
        noHighlight
        amplitude={0.5}
        fill={0.85}
        hollow={0.2}
        core={0.3}
        density={0.32}
        glow={0.55}
        dither={ORB_DITHER}
      />
      {/* Level bars sit in the orb's hollow, at their own scale. */}
      <div className="absolute inset-0 flex items-center justify-center">
        <AudioVisualizerBar
          participantType="bot"
          isConnecting={phase === "starting"}
          barOrigin="center"
          barMaxHeight={size >= 480 ? 96 : 64}
          barLineCap="square"
        />
      </div>
    </div>
  )
}

function VoiceAgent({
  phase,
  speaking,
  error,
  wide,
}: {
  phase: Phase
  speaking: boolean
  error: string | null
  wide: boolean
}) {
  const controls = (
    <div className="flex flex-col gap-2.5 border-t border-border pt-2.5">
      <MicBar />
      <TextInput
        className="flex-1"
        placeholder="talk or type · Enter to send"
      />
    </div>
  )

  return (
    <main
      className={cn(
        "grid min-h-0 flex-1 gap-3 sm:gap-4",
        wide ? "grid-cols-[1.45fr_1fr]" : "grid-cols-1"
      )}
    >
      <Panel
        title="assistant"
        status={
          <SessionStatus
            phase={phase}
            speaking={speaking}
            liveLabel="listening"
          />
        }
        footnote={
          wide ? "saaras v4 · sarvam-105b-conversations · bulbul v4" : undefined
        }
        className="flex min-h-0 flex-col"
      >
        <AgentOrb phase={phase} size={wide ? 520 : 300} />
        <AgentCaption phase={phase} error={error} wide={wide} />
        {!wide && <div className="px-3 pb-3">{controls}</div>}
      </Panel>

      {wide && (
        // The transcript, then the tool calls and the metrics, always in view.
        <div className="flex min-h-0 flex-col gap-3 sm:gap-4">
          <Panel title="transcript" className="flex min-h-0 flex-1 flex-col">
            <div className="flex min-h-0 flex-1 flex-col px-3 pt-5 pb-3 sm:px-4">
              <Conversation />
              <div className="mt-3">{controls}</div>
            </div>
          </Panel>
          <ToolCallsPanel />
          <MetricsPanel />
        </div>
      )}
    </main>
  )
}

/**
 * On a phone, the panels the wide layout shows beside the orb live in trays
 * on the bottom bar; on wider screens there are none.
 */
function TrayBar({ wide }: { wide: boolean }) {
  const toolCalls = useToolCallTotal()
  if (wide) return null

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Tray
        label="transcript"
        description="What you and the assistant said in this session"
      >
        <Panel title="transcript" className="flex min-h-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 flex-col px-3 pt-5 pb-3">
            <Conversation />
          </div>
        </Panel>
      </Tray>
      <Tray
        label="tool calls"
        summary={toolCalls ? String(toolCalls) : undefined}
        description="The reservation tools the assistant called this session"
        active={toolCalls > 0}
      >
        <ToolCallsPanel />
      </Tray>
      <Tray
        label="metrics"
        description="STT, LLM and TTS latency for this session"
      >
        <MetricsPanel />
      </Tray>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

function Session({
  onConnect,
  onDisconnect,
  error,
  isConnecting,
}: {
  onConnect: () => void
  onDisconnect: () => void
  error: string | null
  isConnecting: boolean
}) {
  const transportState = usePipecatClientTransportState() as TransportState
  const speaking = useBotSpeaking()
  const versions = useSessionVersions()
  const wide = useMediaQuery(WIDE_QUERY)
  const phase = isConnecting ? "starting" : phaseOf(transportState, error)

  const session = {
    idle: { label: "session idle", tone: "text-muted-foreground" },
    starting: { label: "session starting", tone: "text-tool" },
    live: { label: "session live", tone: "text-active" },
    error: { label: "session error", tone: "text-inactive" },
  }[phase]

  return (
    <div className="flex h-svh flex-col gap-3 p-3 text-[13px] leading-[1.6] sm:gap-4 sm:p-4">
      <header className="flex min-h-9 shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h1 className="flex shrink-0 items-baseline gap-2 text-base">
          <span className="font-bold">pipecat</span>
          <span className="text-muted-foreground/60">/</span>
          <span className="font-medium text-agent">sarvam</span>
          <span className="hidden text-[13px] text-muted-foreground/70 sm:inline">
            en · hi · hinglish restaurant host
          </span>
        </h1>
        <ConnectButton
          onConnect={onConnect}
          onDisconnect={onDisconnect}
          isConnecting={isConnecting}
        />
      </header>

      <VoiceAgent phase={phase} speaking={speaking} error={error} wide={wide} />

      <footer className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 text-[13px] font-medium">
        <span className={cn("shrink-0", session.tone)}>
          <span className="mr-1.5">▸▸</span>
          {session.label}
        </span>
        <TrayBar wide={wide} />
        {versions.rtvi && (
          <span className="hidden text-muted-foreground/70 lg:inline">
            rtvi v{versions.rtvi} · pipecat-client-js v{versions.client}
          </span>
        )}
      </footer>

      <PipecatClientAudio />
    </div>
  )
}

// ---------------------------------------------------------------------------
// The client
// ---------------------------------------------------------------------------

/**
 * Owns the Pipecat client. Its own Jotai store keeps the SDK's transcript and
 * media atoms out of the module-global default store.
 */
export function App() {
  const [jotaiStore] = useState(createStore)
  const session = sessionConfig()
  const { client, connect, disconnect, error, isConnecting } = usePipecatApp({
    ...session,
    clientOptions: { enableMic: true },
    // The default daily-js media manager on SmallWebRTC, for its echo
    // cancellation. The Daily transport manages devices itself.
    transportOptions:
      session.transportType === "smallwebrtc"
        ? { mediaManager: "daily" }
        : undefined,
  })

  if (!client) {
    return (
      <div className="flex h-svh items-center justify-center text-[13px] text-muted-foreground">
        {error ?? "starting client…"}
      </div>
    )
  }

  return (
    <PipecatClientProvider client={client} jotaiStore={jotaiStore}>
      <Session
        onConnect={connect}
        onDisconnect={disconnect}
        error={error}
        isConnecting={isConnecting}
      />
    </PipecatClientProvider>
  )
}

export default App
