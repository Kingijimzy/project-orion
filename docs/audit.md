# Project Orion implementation audit

Audit baseline: `main` at `83e75af`; this audit is being updated on `feature/orion-trading-workstation`. This is a code and local-test audit. A route or policy in source is not evidence of a successful live account integration.

## User-facing pages

| Page | Current behavior | Status / limitation | Main files |
| --- | --- | --- | --- |
| Home | Workspace links and current provider, sign-in, and in-session market state | Implemented in this branch; values are only shown when present in app state | `src/components/workspace-pages.tsx`, `src/components/orion-app.tsx` |
| AI Chat | Authenticated conversation CRUD, provider/model selection, streamed responses, retry/stop, optional deterministic SMC context | Implemented; screenshot attachment remains disabled; authenticated live persistence has not been independently tested here | `src/components/orion-app.tsx`, `src/app/api/chat/route.ts`, `src/app/api/conversations/route.ts` |
| Voice Orion | LiveKit room UI, short-lived authenticated room token, separate realtime agent worker | Foundation present; no LiveKit credentials or live voice session verified. UI now distinguishes room join from token creation | `src/components/voice-assistant-panel.tsx`, `src/app/api/livekit/token/route.ts`, `voice-agent/` |
| Markets | Bybit V5 public symbols and candle data, selectable category/timeframe, watchlist, freshness and forming/closed labels | Implemented; REST only. No public WebSocket subscription or quote/ticker panel | `src/lib/market/bybit.ts`, `src/app/api/markets/`, `src/components/orion-app.tsx` |
| Forex Reference | Daily reference-rate conversion and selected major/cross currencies | Implemented in this branch using Frankfurter v2; reference rates only, not intraday OHLC or broker bid/ask | `src/components/forex-reference-page.tsx`, `src/app/api/forex/rates/route.ts` |
| SMC Scanner | Daily/4H context and 1H/30M deterministic analysis with profile and saved-history support | Implemented in code; Supabase persistence requires signed-in project verification | `src/lib/smc/`, `src/app/api/smc/`, `src/components/orion-app.tsx` |
| Chart Analyzer | Lightweight Charts candles and deterministic annotations after a scan | Implemented; no manual annotation editor or independent chart market selector | `src/components/smc-candlestick-chart.tsx`, `src/lib/smc/chart-annotations.ts` |
| Strategy Settings | User-owned versioned strategy profiles and rule settings | Implemented; live database authorization not verified | `src/components/strategy-settings-page.tsx`, `src/app/api/strategy-profiles/route.ts` |
| News & Sessions | Existing navigation label | Still a placeholder; no news feed, economic calendar, or sourced event data | `src/components/orion-app.tsx` |
| Trading Journal | Authenticated record creation, saved history, separately appended reviews | Implemented in code; screenshots are URL references only; live RLS/persistence not verified | `src/components/journal-page.tsx`, `src/app/api/journal/`, `src/lib/journal/` |
| Analytics | Journal-derived outcomes, compliance, realized R sample, and setup counts | Implemented in this branch; reads only the signed-in user's journal API and uses no sample trades | `src/components/workspace-pages.tsx`, `src/app/api/journal/route.ts` |
| Lessons & Memory | Searchable educational notes with browser-local completion state | Lessons implemented in this branch. Personal AI memory is not implemented; browser progress is not model context | `src/components/workspace-pages.tsx` |
| Settings & Integrations | Provider/Supabase configuration summaries without exposing credentials | Implemented in this branch; does not edit deployment environment values | `src/components/workspace-pages.tsx` |
| Trading Tools | Deterministic risk, position size, reward/risk, forex pip, costs, and expectancy calculators | Implemented; no order execution | `src/components/trading-tools-page.tsx`, `src/lib/trading/calculators.ts` |

All desktop navigation is in the app sidebar. The Android bottom bar is compact; additional destinations are reachable from the mobile drawer.

## API routes

| Route | Purpose | Key checks / limits |
| --- | --- | --- |
| `POST /api/chat` | Authenticated AI chat stream, optionally with server-fetched Bybit SMC analysis | Validates body/provider/model; no paid-model fallback |
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
| `POST /api/livekit/token` | Short-lived user/room-scoped LiveKit token | Requires Supabase auth; keeps signing secret server-side |

No route currently handles screenshot upload/storage, news or calendar retrieval, forex OHLC candles, Bybit WebSockets, or automated order execution.

## Supabase and privacy

The migrations define private conversations/messages, strategy profiles, SMC analysis snapshots/explanations, journal entries, and journal reviews with owner-scoped RLS. Server routes use the authenticated user and do not need a service-role key. Anonymous requests previously returned no visible rows, but that is not a two-user isolation test. Signed-in writes/reads, cross-user denials, and storage privacy remain unverified because no controlled pair of test users/storage bucket is available here.

Environment configuration uses `.env.example`; `.env.local` is ignored by `.gitignore` and not tracked. Only Supabase URL and publishable/anon key use the `NEXT_PUBLIC_` prefix. OpenRouter, Gemini, and LiveKit secrets remain server-side.

## Verification evidence

- `npm test`: 48 passing after this branch's forex-route tests were added.
- `npm run typecheck`: PASS after current UI and API changes.
- `npm run build`: PASS; Next.js production output includes the FX rates route, LiveKit token route, existing app routes, and PWA manifest.
- Frankfurter v2 direct upstream request: HTTP 200 with dated USD rates during development; route unit tests cover validation, malformed data, and network/upstream failures.
- `npm audit`: no advisories after pinning PostCSS to patched `8.5.23` (overridden transitively for Next.js). Re-run before merge because advisories change.
- Existing production URL `https://project-orion-murex.vercel.app/` returned HTTP 200 and rendered Orion in the session browser. This is the current deployed app, not this feature branch.
- Mobile viewport checks, a feature-branch deployment preview, authenticated Supabase behavior, LiveKit worker startup/session, and image upload: not yet verified.
