import type { ConversationMessage } from "@pipecat-ai/client-react"

/**
 * The SDK can append a fast typed reply to an assistant message that is still
 * inside its 2.5-second speech-finalization window. Keep SDK speech progress,
 * but display its timestamped parts on the correct side of later user turns.
 */
export function orderConversationTurns(
  messages: readonly ConversationMessage[]
): ConversationMessage[] {
  const userTimes = messages
    .filter((message) => message.role === "user")
    .map((message) => Date.parse(message.createdAt))
    .filter(Number.isFinite)
    .sort((a, b) => a - b)

  return messages
    .flatMap((message) => {
      if (message.role !== "assistant" || message.parts.length === 0)
        return [message]
      const start = Date.parse(message.createdAt)
      const boundaries = userTimes.filter((time) => time > start)
      if (boundaries.length === 0) return [message]

      const groups: ConversationMessage[] = []
      let previousBoundary = -1
      for (const part of message.parts) {
        // Equal timestamps retain their original order; the wire has no finer
        // timing information with which to distinguish them.
        const boundary = boundaries.findLastIndex(
          (time) => time < Date.parse(part.createdAt)
        )
        if (groups.length === 0 || boundary !== previousBoundary) {
          groups.push({
            ...message,
            createdAt:
              groups.length === 0 && boundary === -1
                ? message.createdAt
                : part.createdAt,
            parts: [part],
          })
        } else {
          groups[groups.length - 1].parts.push(part)
        }
        previousBoundary = boundary
      }
      return groups
    })
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
}
