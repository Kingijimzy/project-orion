import { it } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_STRATEGY_PROFILE, validateStrategySettings, describeStrategySettings, settingsToEngineOptions } from '../src/lib/smc/strategy-profile';
import { analyzeTimeframe } from '../src/lib/smc/engine';
import { mapSMCAnnotations } from '../src/lib/smc/chart-annotations';
import { breakEvenPrice, cryptoNotional, cryptoQuantity, estimatedTradingCosts, forexPipDistance, forexPipValue, positionSize, rewardRisk, riskAmount, riskPercent, tradeExpectancyR } from '../src/lib/trading/calculators';
import { validateJournalEntry } from '../src/lib/journal/validation';
import { persistJournalEntry, type JournalRepository } from '../src/lib/journal/repository';

const now=Date.UTC(2026,0,1);
const candles=Array.from({length:20},(_,i)=>({timestamp:now+i*60_000,open:100+i%4,high:102+i%4,low:98+i%4,close:101+i%4,volume:10,closed:true}));

it('validates strategy profiles and describes the actual baseline rules',()=>{
  assert.equal(validateStrategySettings(DEFAULT_STRATEGY_PROFILE.settings).ok,true);
  assert.equal(validateStrategySettings({...DEFAULT_STRATEGY_PROFILE.settings,swingLeft:0}).ok,false);
  const description=describeStrategySettings(DEFAULT_STRATEGY_PROFILE.settings).join(' ');
  assert.match(description,/2 bars right/); assert.match(description,/confirmed close-based break/);
});

it('reproduces deterministic analysis with the same closed candle snapshot and profile version',()=>{
  const options={...settingsToEngineOptions(DEFAULT_STRATEGY_PROFILE.settings),now:now+30*60_000,maxDataAgeMs:24*60*60_000};
  const first=analyzeTimeframe(candles,'BTCUSDT','1',options);
  const second=analyzeTimeframe(structuredClone(candles),'BTCUSDT','1',options);
  assert.deepEqual(second,first);
});

it('applies profile FVG enablement, minimum gap, and close-only fill rules',()=>{
  const gapCandles=[
    {timestamp:now,open:99,high:100,low:98,close:99,volume:1,closed:true},
    {timestamp:now+60_000,open:99,high:101,low:99,close:100,volume:1,closed:true},
    {timestamp:now+120_000,open:102,high:103,low:102,close:102.5,volume:1,closed:true},
    {timestamp:now+180_000,open:102.5,high:104,low:101,close:103,volume:1,closed:true},
  ];
  const base=structuredClone(DEFAULT_STRATEGY_PROFILE.settings);
  const normal=analyzeTimeframe(gapCandles,'BTCUSDT','1',{now:now+10*60_000,maxDataAgeMs:24*60*60_000,strategy:base});
  assert.equal(normal.fvgs[0]?.status,'partially-filled');
  const closeOnly=structuredClone(base);closeOnly.fvg.fillMethod='close';
  assert.equal(analyzeTimeframe(gapCandles,'BTCUSDT','1',{now:now+10*60_000,maxDataAgeMs:24*60*60_000,strategy:closeOnly}).fvgs[0]?.status,'untouched');
  const hidden=structuredClone(base);hidden.fvg.enabled=false;
  assert.equal(analyzeTimeframe(gapCandles,'BTCUSDT','1',{now:now+10*60_000,maxDataAgeMs:24*60*60_000,strategy:hidden}).fvgs.length,0);
  const tooLarge=structuredClone(base);tooLarge.fvg.minimumGapPct=.03;
  assert.equal(analyzeTimeframe(gapCandles,'BTCUSDT','1',{now:now+10*60_000,maxDataAgeMs:24*60*60_000,strategy:tooLarge}).fvgs.length,0);
});

it('maps displayed chart annotations directly to the deterministic finding levels and evidence timestamps',()=>{
  const assessment=analyzeTimeframe(candles,'BTCUSDT','1',{now:now+30*60_000,maxDataAgeMs:24*60*60_000,swingLeft:1,swingRight:1});
  const annotations=mapSMCAnnotations({symbol:'BTCUSDT',analysisTimestamp:now+30*60_000,timeframe:'60',state:'Watch',higherTimeframeBias:'neutral',dailyBias:'neutral',fourHourBias:'neutral',lowerTimeframeStructure:assessment.structure,structure:assessment,higherTimeframes:{daily:assessment,fourHour:assessment},alignedCandles:[],relevantLiquidity:assessment.liquidityPools.filter(x=>x.equal),fvgs:assessment.fvgs,orderBlocks:assessment.orderBlocks,supportingEvidence:[],conflictingEvidence:[],requiredConfirmation:[],invalidationConditions:[],dataQuality:{valid:true,stale:false,issues:[]},qualificationRule:'test'});
  const swing=assessment.swings[0];
  if(swing){const mapped=annotations.find(a=>a.id===`swing-${swing.kind}-${swing.timestamp}`);assert.equal(mapped?.price,swing.price);assert.ok(mapped?.evidenceTimestamps.includes(swing.confirmedAt));}
});

it('calculates risk, sizing, targets, FX pips, crypto notional, break-even, costs, and expectancy',()=>{
  assert.equal(riskAmount(10000,1),100);assert.equal(riskPercent(10000,100),1);assert.equal(positionSize(100,100,98),50);assert.equal(cryptoQuantity(100,100,98),50);assert.deepEqual(rewardRisk('long',100,98,[104,106]),[2,3]);assert.ok(Math.abs(forexPipDistance(1.1,1.101,.0001)-10)<1e-8);assert.equal(forexPipValue(.0001,1),10);assert.equal(cryptoNotional(2,100),200);assert.ok(breakEvenPrice('long',100,.001)>100);assert.equal(estimatedTradingCosts(1000,.001,10),2);assert.equal(tradeExpectancyR([2,-1]).expectancyR,.5);assert.throws(()=>rewardRisk('long',100,98,[99]));
});

it('validates journal input and persists an owner-scoped immutable copy through the repository boundary',async()=>{
  const input=validateJournalEntry({symbol:'btcusdt',direction:'long',timeframe:'1H',entry:100,stopLoss:98,outcome:'open',reasoning:'planned'});
  assert.equal(input.ok,true);if(!input.ok)return;
  const rows:Array<{owner:string;entry:unknown}>=[];const repository:JournalRepository={async insertEntry(userId,entry){rows.push({owner:userId,entry});return{data:{id:'entry-1',...entry},error:null};}};
  const original=structuredClone(input.value);await persistJournalEntry(repository,'user-a',input.value);input.value.reasoning='changed afterward';
  assert.equal(rows[0].owner,'user-a');assert.deepEqual(rows[0].entry,original);await assert.rejects(()=>persistJournalEntry(repository,'',original),/Authenticated user id/);
});
