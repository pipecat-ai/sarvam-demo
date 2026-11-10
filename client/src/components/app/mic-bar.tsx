"use client"

import { RTVIEvent } from "@pipecat-ai/client-js"
import {
  usePipecatClientMicControl,
  usePipecatClientTransportState,
  useRTVIClientEvent,
  VoiceVisualizer,
} from "@pipecat-ai/client-react"
import { useCallback, useState } from "react"

import { cn } from "@/lib/utils"

const CONNECTED_STATES = ["connected", "ready"]

/**
 * Resolves a CSS custom property to a colour the canvas visualizer can use
 * (a canvas cannot paint with `var(--x)`). Read once, at mount: the theme
 * does not change under a running session.
 */
function useThemeColor(name: string, fallback: string): string {
  const [color] = useState(() => {
    if (typeof document === "undefined") return fallback
    const value = getComputedStyle(document.documentElement)
      .getPropertyValue(name)
      .trim()
    return value || fallback
  })
  return color
}

export interface MicBarProps {
  className?: string
}

/**
 * The microphone line under the transcript: a mute
 * toggle, the local audio level, and whether the bot's VAD currently hears
 * the user. Must be rendered inside a PipecatClientProvider.
 */
export function MicBar({ className }: MicBarProps) {
  const { enableMic, isMicEnabled } = usePipecatClientMicControl()
  const transportState = usePipecatClientTransportState()
  const connected = CONNECTED_STATES.includes(transportState)
  const barColor = useThemeColor("--color-client", "#7dd3fc")

  const [speaking, setSpeaking] = useState(false)
  useRTVIClientEvent(
    RTVIEvent.UserStartedSpeaking,
    useCallback(() => setSpeaking(true), [])
  )
  useRTVIClientEvent(
    RTVIEvent.UserStoppedSpeaking,
    useCallback(() => setSpeaking(false), [])
  )
  useRTVIClientEvent(
    RTVIEvent.Disconnected,
    useCallback(() => setSpeaking(false), [])
  )

  const status = !connected
    ? { label: "no session", tone: "text-muted-foreground/60" }
    : !isMicEnabled
      ? { label: "muted", tone: "text-inactive" }
      : speaking
        ? { label: "hearing you", tone: "text-active" }
        : { label: "listening", tone: "text-muted-foreground" }

  return (
    <div
      data-slot="mic-bar"
      className={cn("flex min-w-0 items-center gap-3", className)}
    >
      <button
        type="button"
        disabled={!connected}
        aria-pressed={isMicEnabled}
        onClick={() => enableMic(!isMicEnabled)}
        className={cn(
          "flex shrink-0 items-center border px-3 py-1.5 text-[13px] leading-none tracking-[0.06em] uppercase transition-colors disabled:cursor-not-allowed disabled:opacity-50",
          isMicEnabled
            ? "border-client/70 text-client hover:border-client"
            : "border-border text-muted-foreground hover:text-foreground"
        )}
      >
        <span className="mr-1.5 tracking-normal">
          {isMicEnabled ? "▪" : "▸"}
        </span>
        {isMicEnabled ? "mic on" : "mic off"}
      </button>
      <div className="flex h-5 min-w-0 flex-1 items-center">
        <VoiceVisualizer
          participantType="local"
          barCount={24}
          barWidth={3}
          barGap={2}
          barMaxHeight={18}
          barOrigin="center"
          barColor={barColor}
          backgroundColor="transparent"
        />
      </div>
      <span className={cn("shrink-0 text-[13px]", status.tone)}>
        <span className="mr-1.5">●</span>
        {status.label}
      </span>
    </div>
  )
}
