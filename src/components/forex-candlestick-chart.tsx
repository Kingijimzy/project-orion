'use client';

import { useEffect, useRef, useState } from 'react';
import { CandlestickSeries, ColorType, createChart, type IChartApi, type Time } from 'lightweight-charts';
import type { ForexCandle } from '@/lib/market/twelve-data-forex';

export function ForexCandlestickChart({ pair, interval, candles }: { pair: string; interval: string; candles: ForexCandle[] }) {
  const element = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [ohlc, setOhlc] = useState<ForexCandle | null>(null);
  useEffect(() => {
    if (!element.current || !candles.length) return;
    const chart = createChart(element.current, { autoSize: true, layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: '#9ca3af', attributionLogo: true }, grid: { vertLines: { color: 'rgba(148,163,184,.08)' }, horzLines: { color: 'rgba(148,163,184,.08)' } }, rightPriceScale: { borderColor: 'rgba(148,163,184,.2)' }, timeScale: { borderColor: 'rgba(148,163,184,.2)', timeVisible: true, secondsVisible: false } });
    chartRef.current = chart;
    const series = chart.addSeries(CandlestickSeries, { upColor: '#38d39f', downColor: '#fb7185', borderUpColor: '#38d39f', borderDownColor: '#fb7185', wickUpColor: '#38d39f', wickDownColor: '#fb7185' });
    const rows = candles.slice().sort((a, b) => a.timestamp - b.timestamp);
    series.setData(rows.map((c) => ({ time: Math.floor(c.timestamp / 1000) as Time, open: c.open, high: c.high, low: c.low, close: c.close })));
    const crosshair = (param: { time?: Time }) => setOhlc(param.time === undefined ? null : rows.find((c) => Math.floor(c.timestamp / 1000) === Number(param.time)) || null);
    chart.subscribeCrosshairMove(crosshair); chart.timeScale().fitContent();
    const observer = new ResizeObserver(() => chart.timeScale().fitContent()); observer.observe(element.current);
    return () => { observer.disconnect(); chart.unsubscribeCrosshairMove(crosshair); chart.remove(); if (chartRef.current === chart) chartRef.current = null; };
  }, [candles]);
  return <section className="smc-chart-panel"><div className="smc-chart-heading"><b>{pair} · {interval}</b><span>{candles.length} candles · {candles.at(-1)?.closed ? 'Last candle closed' : 'Last candle forming'}</span>{ohlc && <span>O {ohlc.open} · H {ohlc.high} · L {ohlc.low} · C {ohlc.close}</span>}</div><div className="smc-chart-controls"><button onClick={() => chartRef.current?.timeScale().fitContent()} disabled={!candles.length}>Fit content</button></div><div ref={element} className="smc-candlestick" aria-label={`${pair} ${interval} forex candlestick chart`} /></section>;
}
