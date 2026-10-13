'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CandlestickSeries, ColorType, HistogramSeries, createChart, createSeriesMarkers, type Time } from 'lightweight-charts';
import type { OHLCV, SMCAssessment } from '@/lib/smc/engine';
import { mapSMCAnnotations, type ChartAnnotation } from '@/lib/smc/chart-annotations';

export function SMCCandlestickChart({ analysis, candles, timeframe, settings, lastSuccessfulUpdate }: { analysis: SMCAssessment; candles: OHLCV[]; timeframe: string; settings?: { swingLeft: number; swingRight: number }; lastSuccessfulUpdate?:string }) {
  const chartRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<ChartAnnotation | null>(null);
  const [ohlc,setOhlc]=useState<OHLCV|null>(null);
  const annotations = useMemo(() => mapSMCAnnotations(analysis, { left: settings?.swingLeft ?? 2, right: settings?.swingRight ?? 2 }), [analysis, settings]);
  useEffect(() => {
    if (!chartRef.current || candles.length === 0) return;
    const chart = createChart(chartRef.current, { autoSize: true, layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: '#9ca3af', attributionLogo: true }, grid: { vertLines: { color: 'rgba(148,163,184,.08)' }, horzLines: { color: 'rgba(148,163,184,.08)' } }, rightPriceScale: { borderColor: 'rgba(148,163,184,.2)' }, timeScale: { borderColor: 'rgba(148,163,184,.2)', timeVisible: true } });
    const series = chart.addSeries(CandlestickSeries, { upColor: '#38d39f', downColor: '#fb7185', borderUpColor: '#38d39f', borderDownColor: '#fb7185', wickUpColor: '#38d39f', wickDownColor: '#fb7185' });
    const valid = candles.filter(c => [c.timestamp,c.open,c.high,c.low,c.close].every(Number.isFinite)).sort((a,b)=>a.timestamp-b.timestamp);
    series.setData(valid.map(c=>({ time: Math.floor(c.timestamp/1000) as Time, open:c.open, high:c.high, low:c.low, close:c.close })));
    const onCrosshair=(param:{time?:Time;seriesData:Map<unknown,unknown>})=>{if(param.time===undefined){setOhlc(null);return;}const timestamp=Number(param.time)*1000;setOhlc(valid.find(c=>c.timestamp===timestamp)??null);};
    chart.subscribeCrosshairMove(onCrosshair);
    const volume = chart.addSeries(HistogramSeries, { priceFormat: { type:'volume' }, priceScaleId:'volume', color:'#64748b' });
    volume.priceScale().applyOptions({ scaleMargins:{ top:.82, bottom:0 } });
    volume.setData(valid.map(c=>({ time:Math.floor(c.timestamp/1000) as Time, value:c.volume, color:c.close >= c.open?'rgba(56,211,159,.32)':'rgba(251,113,133,.32)' })));
    const marks = annotations.filter(a=>['swing','break','sweep'].includes(a.kind) && a.price !== undefined).map(a=>({ time:a.time as Time, position:(a.kind==='swing' ? (analysis.structure.swings.find(s=>Math.floor(s.timestamp/1000)===a.time)?.kind==='high'?'aboveBar':'belowBar') : a.price! >= (valid.find(c=>Math.floor(c.timestamp/1000)===a.time)?.close ?? a.price!)?'aboveBar':'belowBar') as 'aboveBar'|'belowBar', color:!a.confirmed?'#94a3b8':a.kind==='break'?'#a78bfa':a.kind==='sweep'?'#fbbf24':'#38bdf8', shape:(!a.confirmed?'square':a.kind==='break'?(a.label.includes('bearish')?'arrowDown':'arrowUp'):'circle') as 'square'|'arrowDown'|'arrowUp'|'circle', text:a.label.slice(0,12) }));
    createSeriesMarkers(series, marks);
    const zoneSvg=document.createElementNS('http://www.w3.org/2000/svg','svg'); zoneSvg.setAttribute('aria-hidden','true'); zoneSvg.style.cssText='position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:2;overflow:hidden'; chartRef.current.style.position='relative'; chartRef.current.appendChild(zoneSvg);
    const drawZones=()=>{const width=chartRef.current?.clientWidth??0;const shapes=annotations.filter(a=>['fvg','order-block'].includes(a.kind)&&a.lower!==undefined&&a.upper!==undefined).map(a=>{const x=chart.timeScale().timeToCoordinate(a.time as Time);const y1=series.priceToCoordinate(a.upper!);const y2=series.priceToCoordinate(a.lower!);if(x===null||y1===null||y2===null)return '';const fill=a.kind==='fvg'?'rgba(56,189,248,.12)':'rgba(167,139,250,.12)';const stroke=a.kind==='fvg'?'rgba(56,189,248,.65)':'rgba(167,139,250,.65)';const y=Math.min(y1,y2);return `<rect x="${x}" y="${y}" width="${Math.max(0,width-x-58)}" height="${Math.max(1,Math.abs(y2-y1))}" fill="${fill}" stroke="${stroke}" stroke-dasharray="4 3"/>`;}).join('');zoneSvg.innerHTML=shapes;};
    drawZones(); chart.timeScale().subscribeVisibleLogicalRangeChange(drawZones);
    for (const a of annotations.filter(a=>['fvg','order-block','liquidity'].includes(a.kind))) {
      if (a.price !== undefined) series.createPriceLine({ price:a.price, color:a.kind==='liquidity'?'#fbbf24':'#38bdf8', lineStyle:2, lineWidth:1, axisLabelVisible:true, title:a.label });
      if (a.lower !== undefined && a.upper !== undefined) { const c=a.kind==='fvg'?'rgba(56,189,248,.8)':'rgba(167,139,250,.8)'; series.createPriceLine({ price:a.lower, color:c, lineStyle:2, lineWidth:1, axisLabelVisible:true, title:`${a.label} lower · ${a.status}` }); series.createPriceLine({ price:a.upper, color:c, lineStyle:2, lineWidth:1, axisLabelVisible:true, title:`${a.label} upper · ${a.status}` }); }
    }
    chart.timeScale().fitContent();
    const observer = new ResizeObserver(()=>{chart.timeScale().fitContent();drawZones();}); observer.observe(chartRef.current);
    return ()=>{ observer.disconnect(); chart.unsubscribeCrosshairMove(onCrosshair); chart.timeScale().unsubscribeVisibleLogicalRangeChange(drawZones); zoneSvg.remove(); chart.remove(); };
  }, [analysis, annotations, candles]);
  const focusFinding = (item: ChartAnnotation) => { setSelected(item); const el=chartRef.current; if(el) el.scrollIntoView({behavior:'smooth',block:'center'}); };
  return <section className="smc-chart-panel">
    <div className="smc-chart-heading"><b>{analysis.symbol} · {timeframe}</b><span>{analysis.structure.lastCandleClosed?'Last candle closed':'Last candle forming'} · Analysis {new Date(analysis.analysisTimestamp).toLocaleString()} · Updated {lastSuccessfulUpdate?new Date(lastSuccessfulUpdate).toLocaleString():'unknown'} · {analysis.dataQuality.stale?'STALE':'freshness within threshold'}</span>{ohlc&&<span>O {ohlc.open} · H {ohlc.high} · L {ohlc.low} · C {ohlc.close} · Vol {ohlc.volume}</span>}</div>
    <div ref={chartRef} className="smc-candlestick" aria-label={`${analysis.symbol} ${timeframe} candlestick chart`} />
    <div className="smc-chart-legend">Candles and volume · Engine findings are mapped from the returned assessment; selectable findings below show their evidence.</div>
    <div className="smc-chart-findings">{annotations.map(a=><button key={a.id} onClick={()=>focusFinding(a)}>{a.label} · {a.price !== undefined ? a.price : `${a.lower}–${a.upper}`} · {a.status}</button>)}</div>
    {selected && <aside className="smc-finding-detail"><button aria-label="Close finding" onClick={()=>setSelected(null)}>×</button><b>{selected.label} · {selected.status}</b><p>Created {new Date(selected.createdAt).toLocaleString()}. {selected.confirmed?'Confirmed':'Provisional'}.</p><p><strong>Evidence candles:</strong> {selected.evidenceTimestamps.map(t=>new Date(t).toLocaleString()).join(' · ')}</p><p><strong>Rule:</strong> {selected.rule}</p><p><strong>Invalidation:</strong> {selected.invalidation}</p>{selected.price !== undefined && <p><strong>Price:</strong> {selected.price}</p>}</aside>}
  </section>;
}
