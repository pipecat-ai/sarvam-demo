"""Pretend reservation tools for The Saffron Table, adapted from turkcat's turkish-bot.

Tools are **direct functions**: one async function is both the handler and the schema. Pipecat
derives the tool's name, description, parameters and which are required from the signature and
the Google-style docstring, so listing the function in ``LLMContext(tools=TOOLS)`` is all it
takes. Alongside the reservation tools, ``end_call`` hangs the call up.

The "backend" is an in-memory ``ReservationStore``, one per session, shared with the handlers
through ``PipelineWorker(app_resources=...)`` and read back as ``params.app_resources``. Names are
compared case- and space-insensitively, and confirmation numbers by their digits, because both
arrive through speech recognition and the LLM.

Every result also carries ``reply_language``, the language of the caller's latest message (set
by ``language.CallerLanguageHint``): the reply written after a tool call otherwise drifted into
Hindi for an English caller, pulled by the Hindi name in the result (2026-10-26).

Results give ``date``/``time`` as the host should say them (``"tomorrow, Tuesday 27 October"``,
``"8 pm"``) and the stored values as ``date_iso``/``time_24h``, so the model never has to turn
an ISO date or a 24-hour time into speech itself.

``end_call`` only requests the hang-up. sarvam-105b-conversations calls it with no words (every
scripted run), so its result asks for the goodbye and the LLM runs once more to say it;
``HangUpAfterFarewell`` (after the transport output) ends the worker once that goodbye has played,
or after a few seconds if there was none.
"""

from __future__ import annotations

import asyncio
import re
from contextlib import suppress
from datetime import date, timedelta
from typing import Any

from loguru import logger
from pipecat.frames.frames import (
    BotStartedSpeakingFrame,
    BotStoppedSpeakingFrame,
    EndWorkerFrame,
    Frame,
    FunctionCallResultProperties,
    StartFrame,
)
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor
from pipecat.services.llm_service import FunctionCallParams

from language import REPLY_IN, Language

NOT_FOUND = "No reservation matches that confirmation number or name."


def fold_name(name: str) -> str:
    """Lower-case a name and collapse its spaces: 'PRIYA  Sharma' -> 'priya sharma'."""
    return " ".join(name.lower().split())


def spoken_date(iso: str, today: date) -> str:
    """'2026-10-27' -> 'tomorrow, Tuesday 27 October' (or 'today, ...'); the raw value when it
    isn't a date."""
    try:
        day = date.fromisoformat(iso)
    except (TypeError, ValueError):
        return str(iso)
    words = f"{day:%A} {day.day} {day:%B}"
    relative = {0: "today", 1: "tomorrow"}.get((day - today).days)
    return f"{relative}, {words}" if relative else words


def spoken_time(hhmm: str) -> str:
    """'20:00' -> '8 pm', '12:30' -> '12:30 pm'; the raw value when it isn't a time."""
    match = re.fullmatch(r"\s*(\d{1,2})[:.](\d{2})\s*", str(hhmm))
    if not match:
        return str(hhmm)
    hour, minute = int(match[1]), int(match[2])
    if not (0 <= hour <= 23 and 0 <= minute <= 59):
        return str(hhmm)
    period = "am" if hour < 12 else "pm"
    clock = hour % 12 or 12
    return f"{clock} {period}" if minute == 0 else f"{clock}:{minute:02d} {period}"


class ReservationStore:
    """In-memory stand-in for a real reservation system.

    One instance per session, seeded with tomorrow evening's booking for Priya Sharma
    (confirmation number 101) so lookups can succeed straight away.
    """

    def __init__(self, today: date | None = None) -> None:
        self.today = today or date.today()
        # Set by end_call; HangUpAfterFarewell ends the session once the goodbye has played.
        self.hang_up = asyncio.Event()
        # The language of the caller's latest message, kept up to date by CallerLanguageHint.
        self.caller_language: Language = "mixed"
        tomorrow = self.today + timedelta(days=1)
        self._next_id = 102
        self.reservations: dict[str, dict[str, Any]] = {
            "101": {
                "confirmation_number": "101",
                "name": "Priya Sharma",
                "party_size": 2,
                "date": tomorrow.isoformat(),
                "time": "19:00",
                "special_requests": None,
            },
        }

    def create(
        self, name: str, party_size: int, date: str, time: str, special_requests: str | None
    ) -> dict[str, Any]:
        confirmation_number = str(self._next_id)
        self._next_id += 1
        reservation = {
            "confirmation_number": confirmation_number,
            "name": name,
            "party_size": party_size,
            "date": date,
            "time": time,
            "special_requests": special_requests,
        }
        self.reservations[confirmation_number] = reservation
        return reservation

    def result(self, **fields: Any) -> dict[str, Any]:
        """A tool result: ``fields`` plus the language the reply after it should be in."""
        return {**fields, "reply_language": REPLY_IN[self.caller_language]}

    def describe(self, reservation: dict[str, Any]) -> dict[str, Any]:
        """The reservation as a tool returns it: ``date``/``time`` as spoken English, the stored
        values as ``date_iso``/``time_24h``."""
        return {
            **reservation,
            "date": spoken_date(reservation["date"], self.today),
            "time": spoken_time(reservation["time"]),
            "date_iso": reservation["date"],
            "time_24h": reservation["time"],
        }

    def find(self, confirmation_number: str | None, name: str | None) -> dict[str, Any] | None:
        if confirmation_number:
            digits = re.sub(r"\D", "", str(confirmation_number))
            if digits in self.reservations:
                return self.reservations[digits]
        if name:
            needle = fold_name(name)
            for reservation in self.reservations.values():
                if fold_name(reservation["name"]) == needle:
                    return reservation
        return None


async def get_reservation(
    params: FunctionCallParams,
    confirmation_number: str | None = None,
    name: str | None = None,
):
    """Look up an existing reservation by confirmation number or by the name it's under.

    Args:
        confirmation_number: The reservation's confirmation number, e.g. '101'.
        name: The full name the reservation is under, e.g. 'Priya Sharma'.
    """
    store: ReservationStore = params.app_resources
    reservation = store.find(confirmation_number, name)
    logger.info(f"get_reservation({confirmation_number=}, {name=}) -> {reservation}")
    if reservation:
        await params.result_callback(
            store.result(found=True, reservation=store.describe(reservation))
        )
    else:
        await params.result_callback(store.result(found=False, message=NOT_FOUND))


async def create_reservation(
    params: FunctionCallParams,
    name: str,
    party_size: int,
    date: str,
    time: str,
    special_requests: str | None = None,
):
    """Create a new reservation once the name, party size, date, and time are all known.

    Args:
        name: The full name to put the reservation under.
        party_size: Number of people in the party.
        date: Reservation date in YYYY-MM-DD format.
        time: Reservation time in 24-hour HH:MM format.
        special_requests: Anything to note for the table, e.g. 'quiet corner, birthday'.
    """
    store: ReservationStore = params.app_resources
    reservation = store.create(name, party_size, date, time, special_requests)
    logger.info(f"create_reservation(...) -> {reservation}")
    await params.result_callback(
        store.result(success=True, reservation=store.describe(reservation))
    )


async def update_reservation(
    params: FunctionCallParams,
    confirmation_number: str | None = None,
    name: str | None = None,
    party_size: int | None = None,
    date: str | None = None,
    time: str | None = None,
    special_requests: str | None = None,
):
    """Update an existing reservation.

    Look it up by confirmation number or name, then change only the fields the caller wants
    changed.

    Args:
        confirmation_number: The reservation's confirmation number, e.g. '101'.
        name: The full name the reservation is under (also used to look it up when no confirmation number is given).
        party_size: New number of people in the party.
        date: New reservation date in YYYY-MM-DD format.
        time: New reservation time in 24-hour HH:MM format.
        special_requests: New notes for the table, replacing the old ones.
    """
    store: ReservationStore = params.app_resources
    reservation = store.find(confirmation_number, name)
    updates = {
        "name": name,
        "party_size": party_size,
        "date": date,
        "time": time,
        "special_requests": special_requests,
    }
    if not reservation:
        logger.info(f"update_reservation({confirmation_number=}, {updates}) -> not found")
        await params.result_callback(store.result(success=False, message=NOT_FOUND))
        return
    for field, value in updates.items():
        if value is not None:
            reservation[field] = value
    logger.info(f"update_reservation({confirmation_number=}, {updates}) -> {reservation}")
    await params.result_callback(
        store.result(success=True, reservation=store.describe(reservation))
    )


async def end_call(params: FunctionCallParams):
    """End the call and hang up.

    Use this once the caller is finished: they say goodbye, or their reservation is settled and
    they need nothing else. Say a short, friendly goodbye in the same reply: the call stays up
    until that has finished playing.
    """
    store: ReservationStore = params.app_resources
    logger.info("end_call -> hanging up once the goodbye has played")
    store.hang_up.set()
    # The model calls this without saying goodbye, so the LLM runs once more on the result to
    # say it; HangUpAfterFarewell waits for that to play.
    await params.result_callback(
        store.result(hanging_up=True, next="Say a short, friendly goodbye now."),
        properties=FunctionCallResultProperties(run_llm=True),
    )


class HangUpAfterFarewell(FrameProcessor):
    """Ends the worker once the goodbye that follows ``end_call`` has played.

    Sits after the transport output, where ``BotStarted/StoppedSpeakingFrame`` pass downstream.
    When the store's ``hang_up`` event fires it waits for the bot to start its goodbye (at most
    ``start_timeout_s``; the goodbye may already be playing) and then to stop (at most
    ``speech_timeout_s``), and pushes ``EndWorkerFrame``, which ends the session gracefully.
    """

    def __init__(
        self,
        store: ReservationStore,
        *,
        start_timeout_s: float = 5.0,
        speech_timeout_s: float = 20.0,
        **kwargs,
    ) -> None:
        super().__init__(**kwargs)
        self._store = store
        self._start_timeout_s = start_timeout_s
        self._speech_timeout_s = speech_timeout_s
        self._speaking = False
        self._started = asyncio.Event()
        self._stopped = asyncio.Event()
        self._task: asyncio.Task | None = None

    async def process_frame(self, frame: Frame, direction: FrameDirection) -> None:
        await super().process_frame(frame, direction)
        if isinstance(frame, StartFrame) and self._task is None:
            self._task = self.create_task(self._hang_up_after_goodbye(), name="hang_up")
        elif isinstance(frame, BotStartedSpeakingFrame):
            self._speaking = True
            self._stopped.clear()
            self._started.set()
        elif isinstance(frame, BotStoppedSpeakingFrame):
            self._speaking = False
            self._started.clear()
            self._stopped.set()
        await self.push_frame(frame, direction)

    async def _hang_up_after_goodbye(self) -> None:
        await self._store.hang_up.wait()
        if not self._speaking:
            with suppress(TimeoutError):
                await asyncio.wait_for(self._started.wait(), self._start_timeout_s)
        if self._speaking:
            with suppress(TimeoutError):
                await asyncio.wait_for(self._stopped.wait(), self._speech_timeout_s)
        logger.info(f"{self}: goodbye played, ending the call")
        await self.push_frame(EndWorkerFrame(reason="end_call"))

    async def cleanup(self) -> None:
        await super().cleanup()
        if self._task:
            await self.cancel_task(self._task)
            self._task = None


TOOLS = [get_reservation, create_reservation, update_reservation, end_call]
