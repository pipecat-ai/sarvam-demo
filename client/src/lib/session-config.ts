import type { APIRequest } from "@pipecat-ai/client-js"

import type { TransportType } from "@/lib/transports"

/**
 * Which transport this build connects with (build-time env):
 *
 * - "smallwebrtc" (default): peer-to-peer WebRTC straight to the dev runner
 *   (`uv run bot.py` in ../server). The Vite dev server proxies `/start` and
 *   `/sessions` to it on port 7860 (see vite.config.ts).
 * - "daily": Daily WebRTC. The same runner creates a Daily room (it needs
 *   DAILY_API_KEY) and returns the room and token, which go straight into the
 *   transport. For a bot on Pipecat Cloud, VITE_START_URL is the agent's public
 *   start endpoint and VITE_PCC_API_KEY a Pipecat Cloud *public* API key.
 *
 * VITE_START_URL must end in `/start`: the SmallWebRTC transport derives the
 * offer URL from it (`/sessions/<id>/api/offer`).
 */
const TRANSPORT: TransportType =
  import.meta.env.VITE_TRANSPORT === "daily" ? "daily" : "smallwebrtc"
const START_URL: string = import.meta.env.VITE_START_URL ?? "/start"
const PCC_API_KEY: string | undefined = import.meta.env.VITE_PCC_API_KEY

export interface SessionConfig {
  transportType: TransportType
  /**
   * Params for client.startBot(). The runner registers the session and
   * returns what the transport needs (a sessionId for SmallWebRTC, a Daily
   * room and token for Daily).
   */
  startBotParams: APIRequest
}

/** How this build reaches the bot. */
export function sessionConfig(): SessionConfig {
  if (TRANSPORT === "daily") {
    return {
      transportType: "daily",
      startBotParams: {
        endpoint: START_URL,
        headers: new Headers(
          PCC_API_KEY ? { Authorization: `Bearer ${PCC_API_KEY}` } : {}
        ),
        requestData: { createDailyRoom: true, body: {} },
      },
    }
  }
  return {
    transportType: "smallwebrtc",
    startBotParams: {
      endpoint: START_URL,
      requestData: { transport: "webrtc", body: {} },
    },
  }
}

export { START_URL, TRANSPORT }
