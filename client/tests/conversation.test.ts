import assert from "node:assert/strict"
import { test } from "node:test"
import type {
  ConversationMessage,
  ConversationMessagePart,
} from "@pipecat-ai/client-react"

import { orderConversationTurns } from "../src/lib/conversation.ts"

const at = (seconds: number) => new Date(seconds * 1000).toISOString()
const part = (text: string, seconds: number): ConversationMessagePart => ({
  text,
  createdAt: at(seconds),
  final: true,
})
const message = (
  role: ConversationMessage["role"],
  seconds: number,
  parts: ConversationMessagePart[]
): ConversationMessage => ({
  role,
  createdAt: at(seconds),
  final: false,
  parts,
})

test("fast typed replies appear after their prompts despite SDK assistant reuse", () => {
  const original = message("assistant", 1, [
    part("Old answer.", 1),
    part("नमस्ते!", 4),
    part("एक, दो।", 6),
  ])
  const input = [
    original,
    message("user", 3, [part("Just say hello.", 3)]),
    message("user", 5, [part("Count.", 5)]),
  ]
  const result = orderConversationTurns(input)
  assert.deepEqual(
    result.map((item) => item.parts.map((item) => item.text).join("")),
    ["Old answer.", "Just say hello.", "नमस्ते!", "Count.", "एक, दो।"]
  )
  assert.equal(original.parts.length, 3, "projection must not mutate SDK state")
})

test("normal multipart responses, interim user text, and empty messages are preserved", () => {
  const interim = message("user", 1, [
    { ...part("अभी बोल रहा हूँ", 1), final: false },
  ])
  const reply = message("assistant", 2, [part("पहला।", 2), part("दूसरा।", 3)])
  const empty = message("assistant", 4, [])
  assert.deepEqual(orderConversationTurns([interim, reply, empty]), [
    interim,
    reply,
    empty,
  ])
})

test("same-timestamp parts retain stable source order and speech-progress metadata", () => {
  const spoken = {
    ...part("नमस्ते", 3),
    segment_id: 7,
    text: { spoken: "नम", unspoken: "स्ते" },
  }
  const assistant = message("assistant", 1, [part("", 1), spoken])
  const user = message("user", 3, [part("continue", 3)])
  const result = orderConversationTurns([assistant, user])
  assert.deepEqual(result, [assistant, user])
  assert.equal(result[0].parts[1], spoken)
})
