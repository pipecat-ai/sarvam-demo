#
# Copyright (c) 2024–2026, Daily
#
# SPDX-License-Identifier: BSD 2-Clause License
#

"""sarvam-pipecat-demo - Pipecat Voice Agent

This bot uses a cascade pipeline: Speech-to-Text → LLM → Text-to-Speech,
with every stage powered by Sarvam AI. It is a restaurant host that speaks
English, Hindi, or both blended in one sentence (Hinglish), following the
caller, and looks up, books and changes reservations with the pretend tools
in ``tools.py``:

- STT: Sarvam ``saaras:v4`` in ``codemix`` mode with ``hi-IN``
- LLM: Sarvam ``sarvam-105b-conversations``
- TTS: Sarvam ``bulbul:v4-flash`` with an English–Hindi voice
  (``simran_enhi_customer``)

Run the bot using::

    uv run bot.py
"""

import os
from datetime import datetime
from zoneinfo import ZoneInfo

from dotenv import load_dotenv
from loguru import logger
from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.frames.frames import LLMRunFrame
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.worker import PipelineParams, PipelineWorker
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import (
    LLMContextAggregatorPair,
    LLMUserAggregatorParams,
)
from pipecat.processors.frameworks.rtvi import RTVIFunctionCallReportLevel, RTVIObserverParams
from pipecat.runner.types import RunnerArguments
from pipecat.runner.utils import create_transport
from pipecat.services.sarvam.llm import SarvamLLMService
from pipecat.services.sarvam.stt import SarvamSTTService
from pipecat.services.sarvam.tts import SarvamTTSService
from pipecat.transports.base_transport import BaseTransport, TransportParams
from pipecat.transports.daily.transport import DailyParams
from pipecat.workers.runner import WorkerRunner

from language import CallerLanguageHint
from tools import TOOLS, HangUpAfterFarewell, ReservationStore

load_dotenv(override=True)

SYSTEM_INSTRUCTION = """\
You are Simran, the host at The Saffron Table, a restaurant in Mumbai. You take \
table reservations over a voice call: you look up, book, and change them.

Language: callers speak English, Hindi, or blend the two in one sentence, for example \
"Hi, I'd like to book a table for two tonight, but actually कल के लिए करवा दो, आठ बजे \
के around." Reply in the language the caller is using. Always write Hindi words in \
Devanagari and English words in English, never Hindi in Roman letters.

To book, you need the name, party size, date, and time, plus any special requests (a \
quiet corner, a birthday, dietary needs). Before each reply, go over everything the \
caller has said so far: a caller who changes their mind ("tonight, but actually \
tomorrow") keeps every other detail they gave. Never ask again for a detail you have; \
ask only for what is missing, one or two details at a time. When a caller asks about \
an existing booking, look it up right away with get_reservation. Before you book or \
change a reservation, read the details back briefly and wait for the caller to say \
yes; only then call create_reservation or update_reservation. Once it's booked, give \
them the confirmation number. When the caller is done, say a short, friendly goodbye \
and hang up with end_call.

The tools take dates as YYYY-MM-DD and times as 24-hour HH:MM. Their results give a \
reservation's date and time already as you should say them ("tomorrow, Tuesday 27 \
October", "8 pm"): say those, in the caller's language.

Your replies are spoken aloud: keep them to one or two short sentences, with no \
emojis, lists, or formatting. Say times and numbers as words, such as "आठ बजे" or \
"eight o'clock".\
"""

GREETING_INSTRUCTION = (
    "Greet the caller in one short sentence that blends English and Hindi, and ask how "
    "you can help."
)


RESTAURANT_TZ = ZoneInfo("Asia/Kolkata")


def build_system_instruction() -> str:
    """The host's prompt with today's date, so "कल" and "tonight" resolve."""
    today = datetime.now(RESTAURANT_TZ)
    return f"{SYSTEM_INSTRUCTION}\n\nToday is {today:%A, %-d %B %Y} ({today:%Y-%m-%d}) in Mumbai."


async def run_bot(transport: BaseTransport, runner_args: RunnerArguments) -> None:
    """Run the voice bot for this session."""
    logger.info("Starting bot")

    api_key = os.getenv("SARVAM_API_KEY")
    if not api_key:
        raise RuntimeError("SARVAM_API_KEY is not set (see server/.env.example)")

    # Speech-to-Text service. "codemix" with hi-IN keeps English words in
    # English and Hindi in Devanagari, and still transcribes all-English or
    # all-Hindi turns. Auto-detect ("unknown") tags mixed speech as en-IN and
    # translates or drops the Hindi.
    stt = SarvamSTTService(
        api_key=api_key,
        mode="codemix",
        settings=SarvamSTTService.Settings(
            model="saaras:v4",
            language="hi-IN",
        ),
    )

    # LLM service. The conversations variant of sarvam-105b answers without
    # a reasoning pass: ~1s per reply, where sarvam-105b spent 5-10s thinking.
    llm = SarvamLLMService(
        api_key=api_key,
        settings=SarvamLLMService.Settings(
            model="sarvam-105b-conversations",
            system_instruction=build_system_instruction(),
        ),
    )

    # Text-to-Speech service. An "enhi" persona speaks English, Hindi, and
    # the mix of the two in one voice.
    tts = SarvamTTSService(
        api_key=api_key,
        settings=SarvamTTSService.Settings(
            model="bulbul:v4-flash",
            voice="simran_enhi_customer",
            language="hi-IN",
        ),
    )

    # The session's reservations, shared with the tool handlers as
    # params.app_resources.
    # Mumbai's date, not the server's: Pipecat Cloud runs in UTC, which is a day behind
    # Mumbai from 18:30 to midnight UTC.
    store = ReservationStore(today=datetime.now(RESTAURANT_TZ).date())

    # Notes the language of each caller message on the message itself, and on
    # the store for the tool results (see language.py).
    language_hint = CallerLanguageHint(
        on_language=lambda language: setattr(store, "caller_language", language)
    )

    context = LLMContext(tools=TOOLS)
    user_aggregator, assistant_aggregator = LLMContextAggregatorPair(
        context,
        user_params=LLMUserAggregatorParams(vad_analyzer=SileroVADAnalyzer()),
    )

    pipeline = Pipeline(
        [
            transport.input(),
            stt,
            user_aggregator,
            language_hint,
            llm,
            tts,
            transport.output(),
            HangUpAfterFarewell(store),  # ends the call once end_call's goodbye has played
            assistant_aggregator,
        ]
    )

    worker = PipelineWorker(
        pipeline,
        params=PipelineParams(
            enable_metrics=True,
            enable_usage_metrics=True,
        ),
        # Report tool calls in full (name, arguments, result) so the client
        # can show them; the default level reports neither.
        rtvi_observer_params=RTVIObserverParams(
            metrics_enabled=True,
            function_call_report_level={"*": RTVIFunctionCallReportLevel.FULL},
        ),
        app_resources=store,
    )

    runner = WorkerRunner(handle_sigint=runner_args.handle_sigint)

    @worker.rtvi.event_handler("on_client_ready")
    async def on_client_ready(rtvi):
        # Kick off the conversation
        context.add_message({"role": "developer", "content": GREETING_INSTRUCTION})
        await worker.queue_frames([LLMRunFrame()])

    @transport.event_handler("on_client_connected")
    async def on_client_connected(transport, client):
        logger.info("Client connected")

    @transport.event_handler("on_client_disconnected")
    async def on_client_disconnected(transport, client):
        logger.info("Client disconnected")
        await runner.cancel()

    await runner.add_workers(worker)
    await runner.run()


def _eval_params() -> TransportParams:
    from pipecat.evals.transport import EvalTransportParams

    return EvalTransportParams(audio_in_enabled=True, audio_out_enabled=True)


async def bot(runner_args: RunnerArguments):
    """Main bot entry point."""
    # Krisp is available when deployed to Pipecat Cloud
    if os.environ.get("ENV") != "local":
        from pipecat.audio.filters.krisp_viva_filter import KrispVivaFilter

        krisp_filter = KrispVivaFilter()
    else:
        krisp_filter = None

    transport_params = {
        "daily": lambda: DailyParams(
            audio_in_enabled=True,
            audio_in_filter=krisp_filter,
            audio_out_enabled=True,
        ),
        "webrtc": lambda: TransportParams(
            audio_in_enabled=True,
            audio_in_filter=krisp_filter,
            audio_out_enabled=True,
        ),
        # Headless eval transport for `pipecat eval` (dev only: needs the `dev` group).
        "eval": lambda: _eval_params(),
    }

    transport = await create_transport(runner_args, transport_params)

    await run_bot(transport, runner_args)


if __name__ == "__main__":
    from pipecat.runner.run import main

    main()
