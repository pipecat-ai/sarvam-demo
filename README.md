# Sarvam × Pipecat voice agent

Simran, a restaurant host who takes table bookings in English, Hindi, or Hinglish, following the caller's language. Built with [Pipecat](https://github.com/pipecat-ai/pipecat), with [Sarvam AI](https://www.sarvam.ai/) for every stage.

| Stage | Sarvam model |
| --- | --- |
| STT | `saaras:v4` (`codemix` mode, `hi-IN`) |
| LLM | `sarvam-105b-conversations` |
| TTS | `bulbul:v4-flash`, voice `simran_enhi_customer` |

## Setup

Requires [uv](https://docs.astral.sh/uv/) and Node 22.

1. Sign up at the [Sarvam dashboard](https://dashboard.sarvam.ai) and create an API key.
2. Configure the server:

   ```bash
   cd server
   cp .env.example .env   # set SARVAM_API_KEY
   uv sync
   ```

## Run

Bot (serves on http://localhost:7860):

```bash
cd server
uv run bot.py
```

Client (open http://localhost:5173 and click **Connect**):

```bash
cd client
npm install
npm run dev
```

To use Daily instead of SmallWebRTC, set `VITE_TRANSPORT=daily` in `client/.env.local` and `DAILY_API_KEY` in `server/.env`.

## Test

With the bot running, run the eval scenarios in a second terminal:

```bash
cd server
uv run pipecat eval run evals/reservations.yaml -v
```

## Deploy

The bot deploys to [Pipecat Cloud](https://docs.pipecat.ai/pipecat-cloud/introduction) with `server/pcc-deploy.toml`:

```bash
cd server
pipecat cloud secrets set sarvam-pipecat-demo-secrets --file .env
pipecat cloud deploy --yes
```

The client is a static Vite build (`npm run build`). For a Pipecat Cloud bot, build it with `VITE_TRANSPORT=daily`, `VITE_START_URL=https://api.pipecat.daily.co/v1/public/<agent>/start` and `VITE_PCC_API_KEY=<public key>`.

## Layout

- `server/bot.py`: pipeline, services and prompt
- `server/tools.py`: pretend reservation tools and hang-up
- `server/language.py`: per-message language hint, so replies match the caller
- `server/evals/`: eval scenarios
- `client/`: Vite + React client built on the Pipecat client SDK
