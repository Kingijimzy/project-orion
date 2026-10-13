# Project Orion SMC engine rules

The engine in `src/lib/smc/engine.ts` is deterministic TypeScript. It performs no network, AI, database, or UI work. Candle loading is handled by the `MarketDataService` adapter in `src/lib/smc/market-analysis.ts`.

## Data rules

- Input timestamps are candle open times in milliseconds and must be strictly ascending. Duplicate or unordered timestamps, invalid OHLC relationships, future timestamps, and missing expected bars invalidate the series; invalid series produce no findings.
- The engine excludes candles with `closed: false` by default. With `includeForming`, findings using a forming bar are provisional. `asOfTimestamp` truncates the series before calculations and recomputes whether each candle had closed at that historical time.
- Default stale threshold is 2.5 timeframe periods. `maxDataAgeMs` can set a stricter or looser threshold. Stale inputs cannot qualify.
- Calendar `D`, `W`, and `M` timeframes use UTC boundaries. Minute timeframes use fixed millisecond intervals.

## Swings and structure

- A swing high/low is a strict local extreme relative to two candles to its left and two to its right by default (`swingLeft`, `swingRight`). Tied highs/lows do not qualify. A swing becomes known only when all right-side candles have closed; `confirmedAt` and `confirmedIndex` record that delay. Provisional pivots do not drive confirmed breaks.
- Each confirmed high is HH or LH relative to the preceding confirmed high. Each confirmed low is HL or LL relative to the preceding confirmed low. Trend is bullish only when the latest labels are HH and HL, bearish only when they are LH and LL; otherwise it is neutral.
- BOS/CHoCH occurs when price crosses a previously confirmed swing level. Default `breakMethod: close` requires a close beyond the level. `wick` requires a wick beyond it and is explicitly reported. A break opposite the structure known at that candle is CHoCH; other breaks are BOS. Events use the break candle timestamp/index and the breached swing timestamp/index/price.
- Historical calculations accept `asOfTimestamp`; all later candles are removed before swing, break, gap, or mitigation calculations. Thus a pivot is not backdated to before its right-side confirmation.

## Liquidity

- Confirmed swing highs/lows within 0.1% of the first level in a cluster are grouped. Two or more touches are equal-high/equal-low candidates. Single confirmed swings remain tracked as individual liquidity references.
- A sweep candidate requires a wick to pass the level by 0.01% of the configured tolerance. A close back across the level is separately marked as a rejection observation. A later opposite-direction confirmed CHoCH is recorded separately as reversal confirmation. Candle data alone does not establish institutional intent.

## FVG

- A bullish three-candle FVG exists when candle 3 low is above candle 1 high; its zone is `[candle 1 high, candle 3 low]`. A bearish FVG exists when candle 3 high is below candle 1 low; its zone is `[candle 3 high, candle 1 low]`. Profiles can require a minimum relative gap size or disable FVG detection.
- Default later wicks entering the zone mark partial fill. A wick reaching/passing the far edge marks filled. A close beyond that far edge marks invalidated and takes precedence. A profile may use candle closes to track partial/full fill; invalidation remains close through the far boundary. Status is measured only from candles available at the evaluation time.

## Order blocks

- A candidate requires a confirmed close-based BOS/CHoCH, a break-candle body/range ratio of at least 0.6, and a preceding opposing-color candle within five bars. The nearest such candle is the source; its full high-low range is the default zone. Other opposing candles are not candidates. Profiles can disable candidates, change displacement/lookback, and use source body instead of full range.
- After creation, default wick overlap marks mitigation. Profiles may instead require reaching the zone midpoint or a close through its near boundary. Default invalidation is a close beyond the far boundary; a profile may use wick invalidation. Bullish invalidates below source low; bearish above source high. Each output includes source/creation timestamps, zone, displacement ratio, mitigation state, and invalidation rule.

## Multi-timeframe states

- Higher-timeframe candles are aligned to a lower candle only when the higher candle's UTC end is at or before the lower candle's open timestamp and the data marks it closed.
- Daily and 4H structure must agree for directional bias. The selected 1H or 30M structure must agree for a directional candidate.
- The baseline `Qualified` requirements are fresh valid closed data; aligned Daily/4H and selected lower-timeframe structure; a confirmed aligned close-based BOS/CHoCH after an opposite-side sweep with close-back rejection; a retest of a direction-aligned, unfilled FVG or unmitigated order-block candidate; and at least 3 of 5 confluence observations.
- Strategy profiles can toggle the alignment/sweep/break/retest requirements, set the minimum confluence count (0–5), and set candidate lifetime (1–500 bars). `Setup Forming` means at least a break or rejection-observed sweep while qualification requirements remain unmet. `Invalidated` requires an opposite CHoCH after a current candidate. Other candidates expire at the configured age. Other conditions remain `Watch`.
- `Qualified` describes rule matches only. It is not a forecast, trade instruction, or claim of profitability. These are adjustable baseline rules, not a universal SMC standard.

## Phase 5 profiles, chart, and history

- The built-in Orion Baseline is version 1: swing left/right 2/2; equal-price tolerance 0.1%; close-based BOS/CHoCH; FVG gap threshold 0%; wick fill tracking and close-through invalidation; order blocks require a confirmed close break, 60% body/range displacement, nearest opposite candle within 5 bars, full candle zone, wick-touch mitigation, and close invalidation; candidate lifetime 30 bars; 3 of 5 confluence observations.
- Every saved analysis stores a copy of profile settings, profile name/version, engine version, all four candle series, freshness and findings. Updating a profile increments its version; older analyses are not recalculated. Reopening shows stored findings and candle snapshot.
- Chart annotations map existing engine findings to Lightweight Charts. Candlestick and volume values come from the Bybit response. Zones, levels, and markers use engine output only. Lightweight Charts is Apache-2.0 and its attribution logo is enabled in the chart.
- Strategy and analysis history require the `202610150001_strategy_analysis_journal.sql` migration and authenticated Supabase user. The server uses the public anon key plus cookie session and relies on RLS; no service-role key is used.
