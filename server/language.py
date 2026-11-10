"""Tell the LLM which language the caller just used, so the host's reply matches it.

Left to the prompt alone, sarvam-105b-conversations drifts: told to "match the caller" it kept
answering plain English questions in Hinglish, and told harder it answered Hindi in English.
A per-turn hint in the system instruction did better but still missed, and the model sometimes
read it aloud (scripted calls, 2026-10-26). What held in every run: the hint in brackets at the
end of the caller's own message, plus a one-line ``reply_language`` in each tool result (see
``tools.py``), so a reply written after a tool call still sees it.

The STT runs in ``codemix`` mode, which writes Hindi words in Devanagari and English words in
Latin script, so the script of the caller's latest message says what they spoke.
"""

from __future__ import annotations

import re
from collections.abc import Callable
from typing import Any, Literal, cast

from pipecat.frames.frames import Frame, LLMContextFrame
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor

Language = Literal["english", "hindi", "mixed"]

DEVANAGARI_WORD = re.compile(r"[ऀ-ॿ]+")
LATIN_WORD = re.compile(r"[A-Za-z]+")

HINTS: dict[Language, str] = {
    "english": "The caller's latest message is in English: reply in plain English with no "
    "Hindi words, even if your earlier replies used Hindi, unless they are asking you to speak "
    "Hindi.",
    "hindi": "The caller's latest message is in Hindi: reply in Hindi, written in Devanagari "
    "(everyday English words such as 'table' are fine), unless they are asking you to speak "
    "English.",
    "mixed": "The caller's latest message blends English and Hindi: blend your reply the same "
    "way, even if your earlier replies were in English, switching between the two mid-sentence "
    "with Hindi in Devanagari, for example 'ठीक है, कल आठ बजे के लिए table book कर देती हूँ।'",
}

# The same, as the short note tool results carry.
REPLY_IN: dict[Language, str] = {
    "english": "plain English, no Hindi words",
    "hindi": "Hindi, in Devanagari",
    "mixed": "the same English-Hindi blend as the caller",
}


def caller_language(text: str) -> Language:
    """'English please' -> english; 'शाम सात बजे' -> hindi; 'quiet corner, क्योंकि ...' -> mixed.

    A Hindi sentence with an English loanword or two ('एक table चाहिए') still counts as Hindi.
    """
    hindi = len(DEVANAGARI_WORD.findall(text))
    english = len(LATIN_WORD.findall(text))
    if hindi == 0:
        return "english"
    if english <= max(1, hindi // 4):
        return "hindi"
    return "mixed"


def latest_caller_message(context: LLMContext) -> dict[str, Any] | None:
    """The latest user message with plain-text content, or None when the run wasn't started
    by the caller (the greeting cue, a developer message, comes after the last user turn)."""
    for message in reversed(context.get_messages()):
        if not isinstance(message, dict):
            continue
        role = message.get("role")
        if role in ("developer", "system"):
            return None
        if role == "user":
            return (
                cast(dict[str, Any], message) if isinstance(message.get("content"), str) else None
            )
    return None


class CallerLanguageHint(FrameProcessor):
    """Sits between the user aggregator and the LLM. On each context frame it works out the
    language of the caller's latest message, appends the matching hint to that message (once;
    the hint stays in the history), and reports the language through ``on_language``."""

    def __init__(self, on_language: Callable[[Language], None], **kwargs) -> None:
        super().__init__(**kwargs)
        self._on_language = on_language

    async def process_frame(self, frame: Frame, direction: FrameDirection) -> None:
        await super().process_frame(frame, direction)
        if isinstance(frame, LLMContextFrame) and direction == FrameDirection.DOWNSTREAM:
            message = latest_caller_message(frame.context)
            hinted = message is not None and any(
                message["content"].endswith(f"({hint})") for hint in HINTS.values()
            )
            if message is not None and not hinted:
                language = caller_language(message["content"])
                message["content"] = f"{message['content']}\n\n({HINTS[language]})"
                self._on_language(language)
        await self.push_frame(frame, direction)
