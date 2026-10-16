# Project Orion implementation audit

Audit baseline: `main` at `83e75af`; this audit is being updated on `feature/orion-trading-workstation`. This is a code and local-test audit. A route or policy in source is not evidence of a successful live account integration.

## User-facing pages

| Page | Current behavior | Status / limitation | Main files |
| --- | --- | --- | --- |
| Home | Workspace links and current provider, sign-in, and in-session market state | Implemented in this branch; values are only shown when present in app state | `src/components/workspace-pages.tsx`, `src/components/orion-app.tsx` |
| AI Chat | Authenticated conversation CRUD, provider/model selection, streamed responses, retry/stop, optional deterministic SMC context, transient chart screenshot attachment for OpenRouter vision models | Image input is catalogue-gated and size/type checked server-side. Images are sent to OpenRouter and are not persisted by Orion; provider retention follows OpenRouter terms. Authenticated live persistence has not been independently tested here | `src/components/orion-app.tsx`, `src/app/api/chat/route.ts`, `src/lib/ai/chat-validation.ts`, `src/lib/ai/provider.ts` |
| Voice Orion | LiveKit room UI, short-lived authenticated room token, separate realtime agent worker | Foundation present; no LiveKit credentials or live voice session verified. UI now distinguishes room join from token creation | `src/components/voice-assistant-panel.tsx`, `src/app/api/livekit/token/route.ts`, `voice-agent/` |
| Markets | Bybit V5 REST snapshots plus public kline WebSocket subscription, reconnect/heartbeat, category/timeframe, watchlist, freshness and closed/forming labels | Public linear `BTCUSDT` WebSocket subscription returned an acknowledgement and kline during a live smoke check; full browser UI reconnect behavior is still not E2E verified. No ticker/quote panel | `src/lib/market/bybit.ts`, `src/lib/market/bybit-websocket.ts`, `src/app/api/markets/`, `src/components/orion-app.tsx` |
| Forex Reference | Daily reference-rate conversion and selected major/cross currencies | Implemented in this branch using Frankfurter v2; reference rates only, not intraday OHLC or broker bid/ask | `src/components/forex-reference-page.tsx`, `src/app/api/forex/rates/route.ts` |
| SMC Scanner | Daily/4H context and 1H/30M deterministic analysis with profile and saved-history support | Implemented in code; Supabase persistence requires signed-in project verification | `src/lib/smc/`, `src/app/api/smc/`, `src/components/orion-app.tsx` |
| Chart Analyzer | Lightweight Charts candles and deterministic annotations after a scan | Implemented; no manual annotation editor or independent chart market selector | `src/components/smc-candlestick-chart.tsx`, `src/lib/smc/chart-annotations.ts` |
| Strategy Settings | User-owned versioned strategy profiles and rule settings | Implemented; live database authorization not verified | `src/components/strategy-settings-page.tsx`, `src/app/api/strategy-profiles/route.ts` |
| News & Sessions | Official BLS Employment/CPI and Federal Reserve monetary-policy release feeds, source links/timestamps, refresh and upstream partial-failure handling | Implemented source headlines only. BLS annual schedule links externally; in-app upcoming calendar and forecast/actual/previous values are not implemented | `src/components/news-workspace-page.tsx`, `src/app/api/news/route.ts`, `src/lib/news/official-feeds.ts` |
| Market Outlook | User-triggered Bybit SMC result, sourced BLS/Fed headline context, evidence, conflicts, data freshness, invalidation and confirmation | Implemented for crypto only; headlines are deliberately not scored for impact or treated as directional. No forex technical candles, event calendar values, probabilities, or saved outlook snapshots | `src/components/market-outlook-page.tsx`, `src/app/api/smc/analyze/route.ts`, `src/app/api/news/route.ts` |
| Trading Journal | Authenticated record creation, saved history, separately appended reviews | Implemented in code; screenshots are URL references only; live RLS/persistence not verified | `src/components/journal-page.tsx`, `src/app/api/journal/`, `src/lib/journal/` |
| Analytics | Journal-derived outcomes, compliance, realized R sample, and setup counts | Implemented in this branch; reads only the signed-in user's journal API and uses no sample trades | `src/components/workspace-pages.tsx`, `src/app/api/journal/route.ts` |
| Lessons & Memory | Searchable educational notes with browser-local completion state | Lessons implemented in this branch. Personal AI memory is not implemented; browser progress is not model context | `src/components/workspace-pages.tsx` |
| Settings & Integrations | Provider/Supabase configuration summaries without exposing credentials | Implemented in this branch; does not edit deployment environment values | `src/components/workspace-pages.tsx` |
| Trading Tools | Deterministic risk, position size, reward/risk, forex pip, costs, and expectancy calculators | Implemented; no order execution | `src/components/trading-tools-page.tsx`, `src/lib/trading/calculators.ts` |

All desktop navigation is in the app sidebar. The Android bottom bar is compact; additional destinations are reachable from the mobile drawer.

## API routes

| Route | Purpose | Key checks / limits |
| --- | --- | --- |
| `POST /api/chat` | Authenticated AI chat stream, optionally with server-fetched Bybit SMC analysis or ephemeral chart image | Validates body/provider/model; images limited to 3 MB PNG/JPEG/WebP, signature checked, and selected catalogue model must accept images; no image persistence or paid-model fallback |
| `GET/POST/PATCH/DELETE /api/conversations` | User-scoped conversation list/create/update/delete | Requires Supabase user; provider/model validated |
| `GET /api/providers` | Safe provider status summaries | Never returns API keys; OpenRouter catalogue check may call upstream |
| `GET /api/models` | Model list filtered by free pricing and provider | Rejects unsupported provider; paid model availability gated by server config |
| `GET /api/markets/candles` | Bybit V5 kline history | Validates category, interval, symbol, limit; market service caches and validates data |
| `GET /api/markets/symbols` | Bybit V5 instrument search | Validates category/query and caches symbol results |
| `POST /api/smc/analyze` | Multi-timeframe Bybit SMC scan | Validates category/symbol/timeframe; saves snapshot only with authenticated Supabase access |
| `GET /api/smc/analyses` | User-owned saved analysis search | Requires Supabase auth and RLS |
| `GET/POST /api/strategy-profiles` | User-owned strategy profiles | Requires Supabase auth; input settings validated |
| `GET/POST /api/journal` | User-owned journal records | Requires Supabase auth; bounded and validated writes |
| `POST /api/journal/[id]/review` | Append a review to a user-owned entry | Requires Supabase auth; RLS ties review to the owned entry |
| `GET /api/forex/rates` | Frankfurter v2 daily reference rates | Validates currencies and returned rows; labels reference-only; short edge cache |
| `GET /api/news` | Official BLS and Federal Reserve RSS/Atom release headlines | Source allowlist and HTTPS links; bounded item/title/summary sizes; partial source outages are surfaced |
| `POST /api/livekit/token` | Short-lived user/room-scoped LiveKit token | Requires Supabase auth; keeps signing secret server-side |

No route currently handles private screenshot storage, an in-app economic calendar, forex OHLC candles, Bybit WebSockets, or automated order execution. Chart images are transient request data forwarded to the selected OpenRouter vision model and are not written to Supabase.

## Supabase and privacy

The migrations define private conversations/messages, strategy profiles, SMC analysis snapshots/explanations, journal entries, and journal reviews with owner-scoped RLS. Server routes use the authenticated user and do not need a service-role key. Anonymous requests previously returned no visible rows, but that is not a two-user isolation test. Signed-in writes/reads, cross-user denials, and storage privacy remain unverified because no controlled pair of test users/storage bucket is available here.

Environment configuration uses `.env.example`; `.env.local` is ignored by `.gitignore` and not tracked. Only Supabase URL and publishable/anon key use the `NEXT_PUBLIC_` prefix. OpenRouter, Gemini, and LiveKit secrets remain server-side.

## Verification evidence

- `npm test`: 55 passing, 0 failing; covers image validation/provider modality, official news-feed parsing/failures, FX, Bybit REST/WebSocket parsing, SMC, journal, and provider behavior.
- `npm run typecheck`: PASS after final UI/API changes.
- `npm run build`: PASS; production output includes `/api/news`, `/api/forex/rates`, LiveKit, existing app routes, and PWA manifest.
- Frankfurter v2 direct upstream request: HTTP 200 with dated USD rates during development; route unit tests cover validation, malformed data, and network/upstream failures.
- Official news source check: BLS Employment/CPI Atom feeds and Federal Reserve monetary-policy RSS all returned HTTP 200; parsed 39 sourced items total with no unavailable sources. Unit tests cover parsing, safe links, and partial upstream failure.
- Bybit live WebSocket smoke: connected to the official linear public endpoint, received subscription acknowledgement and one `kline.1.BTCUSDT` candle.
- OpenRouter vision smoke check: the live catalogue confirmed `nvidia/nemotron-3.5-super-vl:free` had zero prompt/completion price and image input while paid access was disabled; a one-pixel PNG request streamed an image description. This verifies the provider/model path, not accuracy on complex user screenshots.
- `npm audit`: no advisories after pinning PostCSS to patched `8.5.23` (overridden transitively for Next.js). Re-run before merge because advisories change.
- Existing production URL `https://project-orion-murex.vercel.app/` returned HTTP 200 and rendered Orion in the session browser. This is the current deployed app, not this feature branch.
- A real OpenRouter image/vision generation request, mobile viewport checks, a feature-branch deployment preview, authenticated Supabase behavior, LiveKit worker startup/session, and private storage: not verified. This branch's preview requires Vercel access and could not be inspected.
