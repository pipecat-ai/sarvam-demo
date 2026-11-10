import type { Transport } from "@pipecat-ai/client-js"

/**
 * The transports this app ships:
 *
 * - "smallwebrtc": the Pipecat dev runner on this machine (`uv run bot.py -t
 *   webrtc`), which serves its own start and offer endpoints.
 * - "daily": Daily WebRTC, which is what a bot on Pipecat Cloud uses; the
 *   start endpoint returns a Daily room and token.
 *
 * Both packages are loaded on demand, so a build only pays for the one a
 * session uses.
 */
export type TransportType = "smallwebrtc" | "daily"

/** Which media manager the SmallWebRTC transport captures audio with. */
export type MediaManagerKind = "wav" | "daily"

/**
 * Constructor options for the selected transport, plus our own
 * `mediaManager` switch (SmallWebRTC only). Typed loosely on purpose:
 * transport packages are optional installs, so their option types can't be
 * referenced here without breaking consumers that don't have them.
 */
export type TransportOptions = Record<string, unknown> & {
  mediaManager?: MediaManagerKind
}

type TransportConstructor = new (options?: Record<string, unknown>) => Transport

/**
 * Dynamically imports the transport class, so it lands in its own chunk and
 * is only fetched when a session starts.
 */
export async function loadTransport(
  transportType: TransportType
): Promise<TransportConstructor> {
  try {
    if (transportType === "daily") {
      const { DailyTransport } = await import("@pipecat-ai/daily-transport")
      return DailyTransport as TransportConstructor
    }
    if (transportType === "smallwebrtc") {
      const { SmallWebRTCTransport } =
        await import("@pipecat-ai/small-webrtc-transport")
      return SmallWebRTCTransport as TransportConstructor
    }
  } catch (loadError) {
    const message =
      loadError instanceof Error ? loadError.message : String(loadError)
    throw new Error(
      `Failed to load transport "${transportType}". Make sure the package ` +
        `is installed: npm install @pipecat-ai/${transportType === "daily" ? "daily" : "small-webrtc"}-transport. ` +
        `Original error: ${message}`,
      { cause: loadError }
    )
  }
  throw new Error(`Unsupported transport type: ${String(transportType)}`)
}

/**
 * Creates a transport instance, loading the package on demand.
 *
 * For SmallWebRTC, `mediaManager: "wav"` swaps the transport's default
 * (daily-js based) media manager for its WavMediaManager. The default stalls
 * the connection in a browser without any microphone even when the mic is
 * disabled; the Wav one tolerates a missing device, so the text-only
 * Text-to-Speech mode connects with it. The microphone modes keep the default
 * ("daily"): it brings echo cancellation, which the Voice Agent needs so the
 * bot's own voice cannot interrupt it. The Daily transport manages devices
 * itself and ignores the switch.
 */
export async function createTransport(
  transportType: TransportType,
  options?: TransportOptions
): Promise<Transport> {
  const TransportClass = await loadTransport(transportType)
  const { mediaManager, ...rest } = options ?? {}
  if (transportType === "smallwebrtc" && mediaManager === "wav") {
    const { WavMediaManager } =
      await import("@pipecat-ai/small-webrtc-transport")
    return new TransportClass({ ...rest, mediaManager: new WavMediaManager() })
  }
  return new TransportClass(rest)
}
