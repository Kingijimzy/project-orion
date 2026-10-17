# Orion LiveKit voice agent

This is a separate LiveKit Agents worker. The Next.js token endpoint and UI cannot generate speech on their own; the worker must be running and registered with the same LiveKit Cloud project.

## Free-to-test notes

LiveKit Cloud currently documents a free Build plan with limited monthly inference credits. The sample uses LiveKit Inference through a realtime model, so test usage is limited by the current plan quota. Do not enable billing or switch to paid models unless you choose to. Check the current plan/pricing before a longer session.

## Requirements

- Python 3.10+
- A free LiveKit Cloud project
- LiveKit API key, secret, and WebSocket URL from that project

## Run locally

1. From this folder, create a virtual environment and install dependencies:

   `python -m venv .venv`

   Windows: `.venv\\Scripts\\activate`; Linux/macOS: `source .venv/bin/activate`

   `pip install -e .`

2. Create `.env.local` in this folder (never commit it):

   ```env
   LIVEKIT_URL=wss://your-project.livekit.cloud
   LIVEKIT_API_KEY=your-api-key
   LIVEKIT_API_SECRET=your-api-secret
   LIVEKIT_AGENT_NAME=orion-voice-agent
   LIVEKIT_REALTIME_MODEL=openai/gpt-realtime-2.1
   LIVEKIT_VOICE=marin
   ```

3. Start the worker with `python agent.py dev` (or use the LiveKit CLI agent dev workflow if your installed SDK version exposes it).

4. In the Orion deployment environment, set `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, and optionally `LIVEKIT_AGENT_NAME`. The web app and worker must use the same LiveKit project.

5. Sign into Orion, open **Voice Orion**, and tap **Start talking**. Allow microphone access.

## Current scope and limitations

- The first phase supports real-time spoken conversation, interruption/turn-taking handled by the realtime model, and audio playback.
- The agent is not yet wired to Orion's Bybit or SMC tools. It must not claim live prices or calculated levels; it tells users to consult the Market/SMC pages for verified data.
- The Next.js token endpoint requires an authenticated Supabase user, issues a short-lived room-specific token, and never exposes the API secret.
- Run the web app's typecheck, tests, and production build after installing the added npm dependencies. This repository connector cannot run those commands directly.
