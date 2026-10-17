# Project Orion

Mobile-first personal trading workspace with authenticated AI chat, selectable providers, and public crypto market data.

## Local setup

1. Create a Supabase project. In **Project Settings → API**, copy the Project URL and the publishable key (or legacy anon key).
2. Copy `.env.example` to `.env.local`. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` to those values. These are public client credentials; Row Level Security protects data. Never use a service-role key in this app.
3. In the Supabase SQL Editor, run migrations in order: [`202610130001_chat_history.sql`](supabase/migrations/202610130001_chat_history.sql), [`202610140001_provider_model_selection.sql`](supabase/migrations/202610140001_provider_model_selection.sql), [`202610150001_strategy_analysis_journal.sql`](supabase/migrations/202610150001_strategy_analysis_journal.sql), and [`202610170001_private_chart_images.sql`](supabase/migrations/202610170001_private_chart_images.sql). The last migration creates a private chart image bucket with user-folder read, upload and delete policies.
4. In the project root, set `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, and `OPENROUTER_ALLOW_PAID_MODEL=false` in `.env.local`, then restart Next.js. OpenRouter is the default provider; the server checks the selected model against the live catalogue and rejects models that are priced or lack sufficient free-pricing metadata.
5. Gemini remains optional. If configured, keep `GEMINI_ALLOW_PAID_MODEL=false`; while paid access is disabled Orion permits only the verified free-tier model `gemini-3.1-flash-lite`.
6. Run `npm install`, `npm run dev`, and create an account in Orion. If Supabase email confirmation is enabled, verify the address before signing in.

Never commit `.env.local`. Gemini and OpenRouter keys are read only by server code and are never returned to client JavaScript. OpenRouter is the default provider. With `OPENROUTER_ALLOW_PAID_MODEL=false`, Orion only lists or calls models whose catalogue entry confirms zero input and output pricing and marks them free (for example, a `:free` model ID when request pricing is omitted). It does not fall back to another model. Gemini remains optional and is not selected for new conversations. Direct OpenAI-compatible and DeepSeek-compatible endpoints remain unavailable in this phase.

## Data and privacy

Conversations and messages are owned by the authenticated Supabase `auth.users` identity. The API verifies the user on every request, and RLS independently scopes database access. Messages are append-only in this phase; deleting a conversation cascades to its messages. No service-role credential is needed.

## Phase 5 tools

The Chart Analyzer renders Bybit candles and deterministic SMC annotations with Lightweight Charts. It is Apache-2.0 licensed and the required attribution logo is enabled. The Strategy Settings page supports named, versioned profiles; each saved analysis records a reproducible candle snapshot, settings/version, engine version, freshness, and results. Chat's optional SMC tool uses the signed-in user's selected profile and saves that same profile version with the result. For explicit journal-review or past-trade questions, chat retrieves up to eight of the signed-in user's saved journal records for that request; this is not permanent model learning. The Trading Journal and profile/history APIs require a signed-in Supabase user and the migrations above. Forex calculators and daily reference rates are available; Twelve Data intraday candles require `TWELVE_DATA_API_KEY`. New screenshots are saved in private, user-scoped Supabase Storage and linked to their chat messages. They are also transmitted to the selected OpenRouter vision model for inference; provider retention terms apply. AI reviews are appended separately after they are generated in chat and pasted into the journal review form; the app does not invent review text.

The Trading Tools page separates linear crypto quantity/notional assumptions from forex pip formulas and shows cost assumptions. Outcome statistics remain hidden until at least 10 closed journal trades are available. They do not establish setup quality or future profitability.

News & Sessions displays release headlines directly from official BLS Employment Situation/CPI feeds and the Federal Reserve monetary policy feed. Its in-app calendar loads the next 120 days of scheduled BLS releases and FOMC date ranges from official sources. If the BLS calendar subscription endpoint is blocked, Orion falls back to official month-list schedules; those pages do not provide consensus forecasts, impact scores, or actual/previous event comparisons, so Orion leaves those values unrated and empty. Chart screenshot attachments are validated as PNG, JPEG, or WebP up to 3 MB, stored in a private Supabase bucket, and delivered through an authenticated no-store image route. The message stores only the private object path in metadata. The selected OpenRouter vision model receives the image for analysis; provider retention terms apply. Gemini image analysis is not implemented.

The Market Outlook view combines a requested crypto SMC assessment from Bybit with a separate list of recent official U.S. macro release headlines. It shows supporting/conflicting rules, freshness, invalidation, and confirmation needs. It does not assign news impact, produce probabilities, or cover forex technical candles; upcoming BLS/FOMC dates link to their official calendars.

Markets starts with a validated Bybit V5 REST candle snapshot and subscribes to the matching public kline WebSocket for forming/closed updates, with ping heartbeat and reconnect behavior. The app uses public market data only and cannot place exchange orders.

## Verification

- `npm test` runs the provider, chat, market-data, SMC, strategy, chart-mapping, calculator, and journal repository tests.
- `npm run typecheck` checks TypeScript.
- `npm run build` creates the production build.

## Install on Android

After deploying Orion to its HTTPS Vercel URL, open that URL in Chrome on Android, tap **⋮ → Add to Home screen** (or **Install app**, if Chrome shows it), then confirm. Orion includes a standalone PWA manifest and 192px/512px icons. The service worker enables installation but intentionally does not cache private pages or API responses, so offline use is not enabled.

## OpenRouter (optional)

Set `OPENROUTER_API_KEY` and `OPENROUTER_MODEL` in `.env.local` to validate the key, selected model, and catalogue. The configured default is `nvidia/nemotron-3.5-lightning:free`. The server requires zero input and output prices plus either explicit `:free` model labeling when request pricing is omitted, or zero request pricing. Models with nonzero or insufficient pricing metadata are blocked while paid access is disabled. No fallback is made if a model fails. The app uses OpenRouter's streaming Chat Completions endpoint and public model catalogue. See [OpenRouter model catalogue docs](https://openrouter.ai/docs/api/api-reference/models/get-models) and [Chat Completions docs](https://openrouter.ai/docs/api/api-reference/chat/send-chat-completion-request).

Each conversation stores the selected provider and model ID, and each message records provider, model ID, and assistant mode. OpenAI-compatible and DeepSeek-compatible direct endpoints are still unimplemented; models from those organizations may appear in OpenRouter only when the OpenRouter key can actually route the selected model.

## Bybit public market data

The Markets page reads public V5 candle and instrument endpoints. No Bybit API key is required; private trading endpoints are not used. Choose a market category, search symbols, add them to the browser-local watchlist, and select a timeframe. Candle times are exchange UTC timestamps displayed in your local timezone. The current forming candle is marked separately from closed candles, and stale data is flagged. The server caches candles briefly and symbol lists for five minutes. `MarketDataService` in `src/lib/market/bybit.ts` is the typed boundary for future consumers such as an SMC engine; no SMC calculations are implemented here.

Live verification: Bybit's public `linear/BTCUSDT` 1-hour candle endpoint returned `retCode: 0` and timestamps that parsed as 03:00, 04:00, and 05:00 UTC on 2026-10-13; the 05:00 candle was correctly marked as forming at the 05:40 UTC verification time. On 2026-10-13, the configured Gemini key could read the `gemini-3.1-flash-lite` model metadata, and that model advertised `generateContent`. A text-generation request was not sent because this workspace cannot determine whether the Google project is on the free or paid billing tier. Supabase PostgREST returned HTTP 200 for the migrated conversation, message, strategy, analysis, and journal tables using only the public key and no user session; this confirms the tables are reachable but does not verify authenticated writes or reads. Gemini generation, OpenRouter generation, and signed-in Supabase persistence are covered only by mocks/code paths here.

OpenRouter catalogue verification on 2026-10-13: the configured key loaded the current model catalogue and resolved `nvidia/nemotron-3.5-lightning:free` as text-capable with zero prompt and completion prices. The catalogue omitted request-level pricing for that entry, while marking it with the explicit `:free` model ID. No live chat-completion request was sent, so generated responses remain unverified.

## Deterministic SMC analysis

The SMC Scanner and Market Analysis pages use the pure engine in `src/lib/smc/engine.ts`; `/api/smc/analyze` obtains Daily, 4H, 1H, and 30M candles through `MarketDataService`. The chat composer can opt into the same server-side tool for the selected provider. Chat receives a compact structured result while a separate deterministic card displays the engine's calculated levels. Model text does not replace that card. Rules, defaults, confirmation delays, state qualification, and limitations are documented in [`docs/smc-engine.md`](docs/smc-engine.md).

Phase 5 endpoints and migration compile and are covered by mocked/pure tests only. No Supabase account credentials are configured in this workspace, so live database migration, RLS behavior, profile persistence, analysis history, and journal persistence have not been verified against a live project. Existing live verification for Bybit public REST and the mock-only provider status are described above.


## LiveKit real-time voice (free-to-test)

Orion includes a **Voice Orion** workspace backed by LiveKit. The web app requests a short-lived, room-scoped token from `/api/livekit/token`; the endpoint requires an authenticated Supabase user and keeps the LiveKit API secret on the server. The browser receives only the temporary room token. The token endpoint returns HTTP 503 until the server-side LiveKit variables are configured.

### Configure the web app

Set these variables in the deployment environment (for example, Vercel Project Settings → Environment Variables), then redeploy:

- `LIVEKIT_URL`: the LiveKit Cloud WebSocket URL, such as `wss://your-project.livekit.cloud`
- `LIVEKIT_API_KEY`
- `LIVEKIT_API_SECRET`
- `LIVEKIT_AGENT_NAME=orion-voice-agent` (optional)

Never put `LIVEKIT_API_SECRET` in a `NEXT_PUBLIC_*` variable, browser code, screenshots, or committed files.

### Run the voice agent

See [voice-agent/README.md](voice-agent/README.md). The agent is a separate Python process and must be running against the same LiveKit project. LiveKit documents a limited free Build plan with monthly inference credits; voice-model usage is not unlimited. Check current plan limits before longer sessions. The first agent uses LiveKit Inference for real-time speech and does not need a separate OpenAI API key.

### Current scope and safety

Voice Orion currently has a LiveKit room UI, authenticated short-lived room-token endpoint, and separate Python agent source. The agent is **not connected to Bybit candles or the deterministic SMC tool**. It must not invent live prices, price levels, or news and does not place trades. The feature branch's npm tests, typecheck, and production build pass, but the LiveKit credentials, worker startup, microphone permissions, room join, and speech response have not been tested end to end. Do not treat voice as available until those live checks pass.

## Forex reference data and intraday candles

The feature branch keeps Frankfurter's free public FX reference-rate converter and adds a separate Twelve Data intraday-candle adapter. Frankfurter observations are daily reference data, not broker bid/ask quotes. Twelve Data's individual Basic plan currently advertises real-time forex and 800 API credits/day with 8 credits/minute; the time-series endpoint costs one credit per symbol. It requires server-only `TWELVE_DATA_API_KEY`, caches each pair/interval request for 60 seconds, and reports its REST candle latency (typically 0.3–2 minutes after close). The free plan is for personal/internal, non-commercial use; review the provider's current terms and limits before deployment. See [Twelve Data pricing](https://twelvedata.com/pricing), [time-series docs](https://twelvedata.com/docs/ai/ai-data-assistant), and [data delays](https://support.twelvedata.com/en/articles/5203307-data-delays).

Official U.S. BLS/Federal Reserve news and event schedules are implemented, with an official BLS month-list fallback if its ICS endpoint is blocked. News is not scored for directional impact, and the Market Outlook remains crypto-only; numerically calibrated probabilities are not implemented.
