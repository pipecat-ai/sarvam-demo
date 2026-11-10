"use client"

import type { ConversationMessage } from "@pipecat-ai/client-react"
import { isMessageEmpty } from "@pipecat-ai/client-react"
import { useEffect, useState, type ReactNode } from "react"

import { textLang } from "@/lib/script"
import { cn } from "@/lib/utils"

/** Animated "…" printed in place of a message that has no text yet. */
export function Thinking({
  className,
  interval = 500,
  maxDots = 3,
}: {
  className?: string
  interval?: number
  maxDots?: number
}) {
  const [dots, setDots] = useState(1)

  useEffect(() => {
    const timer = setInterval(() => {
      setDots((previous) => (previous % maxDots) + 1)
    }, interval)
    return () => clearInterval(timer)
  }, [interval, maxDots])

  return (
    <span className={className} aria-label="Thinking">
      {".".repeat(dots)}
    </span>
  )
}

export interface MessageRowProps {
  /** Glyph in the left column, marking who or what the line came from. */
  glyph: string
  glyphClassName?: string
  /** Language of the line's text, e.g. "hi" for a Devanagari line. */
  lang?: string
  className?: string
  children: ReactNode
}

/**
 * One printed line of the transcript: a fixed-width glyph column, then the
 * line's text. Every row uses the same column, so text starts on the same
 * column throughout and wrapped text falls back under the glyph.
 */
export function MessageRow({
  glyph,
  glyphClassName,
  lang,
  className,
  children,
}: MessageRowProps) {
  return (
    <p lang={lang} className={cn("wrap-break-word", className)}>
      <span className={cn("inline-block w-3.25 select-none", glyphClassName)}>
        {glyph}
      </span>
      {children}
    </p>
  )
}

/** Flattens a message's parts into the text it reads as. */
export function messageText(message: ConversationMessage): string {
  const parts = Array.isArray(message.parts) ? message.parts : []
  return parts
    .map((part) => {
      const text = part.text
      if (typeof text === "string") return text
      // Bot output arrives split into what has been spoken and what is
      // still queued behind the TTS; the transcript prints the whole line.
      if (text && typeof text === "object" && "spoken" in text) {
        return `${text.spoken}${text.unspoken}`
      }
      return ""
    })
    .join("")
}

export interface ConversationMessageItemProps {
  message: ConversationMessage
  className?: string
}

/**
 * One conversation message as a transcript line, marked by who produced
 * it: the user's prompt caret, the agent's dot, a tool call's ellipsis.
 */
export function ConversationMessageItem({
  message,
  className,
}: ConversationMessageItemProps) {
  if (message.role === "function_call") {
    return (
      <MessageRow
        glyph="⋮"
        glyphClassName="text-muted-foreground/60"
        className={className}
      >
        <span className="text-muted-foreground">tool called: </span>
        <span className="text-tool">
          {message.functionCall?.function_name ?? "unknown"}
        </span>
      </MessageRow>
    )
  }

  const text = messageText(message)
  const lang = textLang(text)
  const body = isMessageEmpty(message) ? (
    <Thinking className="text-muted-foreground" />
  ) : (
    text
  )

  if (message.role === "user") {
    // Spoken turns arrive as parts: interim text (not yet final) prints
    // muted while the STT service is still deciding, then settles.
    const parts = Array.isArray(message.parts) ? message.parts : []
    const spoken = !isMessageEmpty(message) && parts.length > 0 && (
      <>
        {parts.map((part, index) => (
          <span
            key={`${part.createdAt}-${index}`}
            className={part.final ? undefined : "text-muted-foreground"}
          >
            {typeof part.text === "string" ? part.text : text}
            {index < parts.length - 1 ? " " : ""}
          </span>
        ))}
      </>
    )
    return (
      <MessageRow
        glyph="❯"
        glyphClassName="text-client"
        lang={lang}
        className={className}
      >
        {spoken || body}
      </MessageRow>
    )
  }
  if (message.role === "assistant") {
    return (
      <MessageRow
        glyph="●"
        glyphClassName="text-active"
        lang={lang}
        className={className}
      >
        {body}
      </MessageRow>
    )
  }
  return (
    <MessageRow
      glyph="◆"
      glyphClassName="text-muted-foreground/70"
      className={cn("text-muted-foreground/70", className)}
    >
      {body}
    </MessageRow>
  )
}
