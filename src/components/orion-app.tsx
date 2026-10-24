'use client';

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { Activity, ArrowUpRight, BarChart3, Bell, BrainCircuit, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, Compass, FileText, Globe2, LayoutDashboard, LoaderCircle, Menu, MessageSquare, MoreHorizontal, Plus, Search, Send, Settings2, ShieldCheck, Sparkles, SquarePen, TrendingUp, Trash2, Pencil, X, LogOut, StopCircle, RotateCcw } from 'lucide-react';
import type { AuthChangeEvent, Session, User } from '@supabase/supabase-js';
import { getSupabaseBrowserClient, supabaseBrowserConfiguration } from '@/lib/supabase/client';
import type { BybitCategory, BybitInterval, Candle, MarketSymbol } from '@/lib/market/bybit';
import type { SMCAssessment } from '@/lib/smc/engine';
import type { OHLCV } from '@/lib/smc/engine';
import { SMCCandlestickChart } from './smc-candlestick-chart';
import { StrategySettingsPage } from './strategy-settings-page';
import { TradingToolsPage } from './trading-tools-page';
import { JournalPage } from './journal-page';

type ChatMessage = { id?: string; role: 'assistant' | 'user'; text: string; imageDataUrl?: string; imageName?: string; status?: 'loading' | 'error' | 'stopped' };
type PendingImage = { name: string; mimeType: 'image/jpeg' | 'image/png' | 'image/webp'; data: string; dataUrl: string };
type Conversation = { id: string; title: string; provider: ProviderId; model_id: string | null; created_at: string; updated_at: string };
type Mode = 'general' | 'trading-coach' | 'chart-analysis' | 'journal-review';
type ProviderId = 'gemini' | 'openrouter' | 'openai-compatible' | 'deepseek-compatible';
type ProviderInfo = { configured: boolean; model?: string | null; paidUseEnabled?: boolean; message?: string };
type ModelOption = { id: string; name: string; free: boolean | null; contextLength: number | null };
type SMCResponse = { analysis: SMCAssessment; source: string; lastSuccessfulUpdate: string; candles: { daily: OHLCV[]; fourHour: OHLCV[]; oneHour: OHLCV[]; thirtyMinute: OHLCV[] }; strategyProfile?: { id:string; name:string; version:number; settings:{swingLeft:number;swingRight:number} }; engineVersion?:string; savedAnalysisId?:string|null; historyWarning?:string|null };
const nav = [
  { title: 'Workspace', items: [{ name: 'Home', icon: LayoutDashboard }, { name: 'AI Chat', icon: MessageSquare }, { name: 'Markets', icon: TrendingUp }, { name: 'SMC Scanner', icon: Search }, { name: 'Chart Analyzer', icon: BarChart3 }, { name: 'Strategy Settings', icon: Settings2 }, { name: 'Trading Tools', icon: Compass }] },
  { title: 'Review', items: [{ name: 'News & Sessions', icon: Globe2 }, { name: 'Trading Journal', icon: FileText }, { name: 'Analytics', icon: Activity }, { name: 'Lessons & Memory', icon: BrainCircuit }] },
];
const suggestions = [
  { title: 'Analyze a chart', caption: 'Read structure and liquidity', icon: BarChart3, prompt: 'Help me analyze a chart. What market and timeframe should I start with?' },
  { title: 'Review a trade', caption: 'Separate process from outcome', icon: FileText, prompt: 'I want to review a trade. Help me assess the setup and execution objectively.' },
  { title: 'Calculate risk', caption: 'Size a position from your risk', icon: ShieldCheck, prompt: 'Help me calculate position size. What inputs do you need?' },
  { title: 'Explain a concept', caption: 'FVG, liquidity, structure…', icon: Sparkles, prompt: 'Explain fair value gaps and how to evaluate whether one matters.' },
];
const providerNames: Record<ProviderId, string> = { gemini: 'Gemini', openrouter: 'OpenRouter', 'openai-compatible': 'OpenAI-compatible', 'deepseek-compatible': 'DeepSeek-compatible' };
const modeNames: Record<Mode, string> = { general: 'General chat', 'trading-coach': 'Trading coach', 'chart-analysis': 'Chart analysis', 'journal-review': 'Journal review' };

type ApiError = { error?: string; message?: string };
async function responseError(response: Response): Promise<string> {
  try { const body = await response.json() as ApiError; return body.message || 'The request failed. Please try again.'; }
  catch { return 'The request failed. Please try again.'; }
}

function formatLevel(value: number): string { return value.toLocaleString(undefined, { maximumSignificantDigits: 10 }); }
function SMCResultCard({ value, compact = false }: { value: SMCResponse; compact?: boolean }) {
  const analysis = value.analysis;
  const lastCandle = analysis.structure.lastCandleTimestamp;
  return <section className={`smc-result-card ${compact ? 'smc-result-compact' : ''}`}>
    <div className="smc-result-heading"><div><span className="eyebrow">DETERMINISTIC ENGINE · {analysis.symbol} · {analysis.timeframe === '30' ? '30M' : '1H'}</span><h3>{analysis.state}</h3></div><span className={`smc-state smc-state-${analysis.state.toLowerCase().replaceAll(' ', '-')}`}>{analysis.state}</span></div>
    <div className="smc-result-meta">Daily {analysis.dailyBias} · 4H {analysis.fourHourBias} · {analysis.timeframe === '30' ? '30M' : '1H'} structure {analysis.lowerTimeframeStructure} · {analysis.structure.lastCandleClosed ? 'last candle closed' : 'last candle forming'}</div>
    <div className="smc-result-meta">Analysis {new Date(analysis.analysisTimestamp).toLocaleString()} · Last candle {lastCandle ? new Date(lastCandle).toLocaleString() : 'Unavailable'} · Feed updated {new Date(value.lastSuccessfulUpdate).toLocaleString()}</div>
    {!analysis.dataQuality.valid || analysis.dataQuality.stale ? <div className="market-warning">Data quality blocks qualification.{analysis.dataQuality.issues.length ? ` ${analysis.dataQuality.issues.join(' ')}` : ''}</div> : null}
    <div className="smc-evidence-grid"><div><b>Supporting evidence</b>{analysis.supportingEvidence.length ? <ul>{analysis.supportingEvidence.map((item,index)=><li key={index}>{item}</li>)}</ul> : <p>No supporting evidence established.</p>}</div><div><b>Conflicting evidence</b>{analysis.conflictingEvidence.length ? <ul>{analysis.conflictingEvidence.map((item,index)=><li key={index}>{item}</li>)}</ul> : <p>No conflict detected in the evaluated rules.</p>}</div></div>
    {compact && <div className="smc-detail-grid"><div><b>Engine price levels · liquidity</b>{analysis.relevantLiquidity.length ? analysis.relevantLiquidity.slice(-5).map((item,index)=><p key={index}>{item.kind === 'high' ? 'Equal highs' : 'Equal lows'} · {formatLevel(item.level)}</p>) : <p>No equal liquidity pool detected.</p>}</div><div><b>Engine price levels · zones</b>{[...analysis.fvgs.slice(-4).map((item) => ({ direction: item.direction, lower: item.lower, upper: item.upper, status: item.status, type: 'FVG' })), ...analysis.orderBlocks.slice(-4).map((item) => ({ direction: item.direction, lower: item.lower, upper: item.upper, status: item.status, type: 'OB' }))].slice(-6).map((item,index)=><p key={index}>{item.type} {item.direction} · {formatLevel(item.lower)}–{formatLevel(item.upper)} · {item.status}</p>)}</div></div>}
    {!compact && <>
      <div className="smc-detail-grid"><div><b>Liquidity levels</b>{analysis.relevantLiquidity.length ? analysis.relevantLiquidity.map((item,index)=><p key={index}>{item.kind === 'high' ? 'Equal highs' : 'Equal lows'} · {formatLevel(item.level)} · {item.touches} touches</p>) : <p>No equal liquidity pools detected.</p>}</div><div><b>Recent structure events</b>{analysis.structure.structureBreaks.slice(-6).reverse().map((item,index)=><p key={index}>{item.kind} {item.direction} · {formatLevel(item.price)} · {new Date(item.timestamp).toLocaleString()} · {item.confirmed ? 'confirmed' : 'provisional'}</p>)}</div></div>
      <div className="smc-detail-grid"><div><b>FVG candidates</b>{analysis.fvgs.length ? analysis.fvgs.slice(-8).reverse().map((item,index)=><p key={index}>{item.direction} · {formatLevel(item.lower)}–{formatLevel(item.upper)} · {item.status}{item.confirmed ? '' : ' · provisional'}</p>) : <p>No three-candle gaps detected.</p>}</div><div><b>Order-block candidates</b>{analysis.orderBlocks.length ? analysis.orderBlocks.slice(-8).reverse().map((item,index)=><p key={index}>{item.direction} · {formatLevel(item.lower)}–{formatLevel(item.upper)} · {item.status} · displacement {Math.round(item.displacementRatio * 100)}%</p>) : <p>No candidate met the defined structure-break and displacement rules.</p>}</div></div>
      <div className="smc-detail-grid"><div><b>Required confirmation</b><ul>{analysis.requiredConfirmation.map((item,index)=><li key={index}>{item}</li>)}</ul></div><div><b>Invalidation</b><ul>{analysis.invalidationConditions.map((item,index)=><li key={index}>{item}</li>)}</ul></div></div>
      <p className="smc-rule-note">{analysis.qualificationRule}</p>
    </>}
    <p className="smc-engine-note">This deterministic result owns the displayed price levels. AI explanations are separate and cannot change these calculated values. A Qualified state does not imply profitability.</p>
  </section>;
}

export default function OrionApp() {
  const [active, setActive] = useState('AI Chat');
  const [drawer, setDrawer] = useState(false);
  const [provider, setProvider] = useState<ProviderId>('openrouter');
  const [selectedModel, setSelectedModel] = useState('');
  const [models, setModels] = useState<ModelOption[]>([]);
  const [modelSearch, setModelSearch] = useState('');
  const [freeOnly, setFreeOnly] = useState(false);
  const [freeFilterAvailable, setFreeFilterAvailable] = useState(false);
  const [modelsBusy, setModelsBusy] = useState(false);
  const [mode, setMode] = useState<Mode>('trading-coach');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [attachedImage, setAttachedImage] = useState<PendingImage | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const [chatTitle, setChatTitle] = useState('New conversation');
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [providerInfo, setProviderInfo] = useState<ProviderInfo>({ configured: false });
  const [openRouterInfo, setOpenRouterInfo] = useState<ProviderInfo>({ configured: false });
  const [providerNotice, setProviderNotice] = useState('Checking provider configuration…');
  const [supabaseReady, setSupabaseReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [authNotice, setAuthNotice] = useState('');
  const [authError, setAuthError] = useState('');
  const [chatError, setChatError] = useState('');
  const [failedPrompt, setFailedPrompt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const activeRequestRef = useRef(0);
  const [marketCategory, setMarketCategory] = useState<BybitCategory>('linear');
  const [marketSymbol, setMarketSymbol] = useState('BTCUSDT');
  const [marketInterval, setMarketInterval] = useState<BybitInterval>('60');
  const [marketCandles, setMarketCandles] = useState<Candle[]>([]);
  const [marketUpdated, setMarketUpdated] = useState('');
  const [marketStale, setMarketStale] = useState(false);
  const [marketBusy, setMarketBusy] = useState(false);
  const [marketRefreshToken, setMarketRefreshToken] = useState(0);
  const [marketError, setMarketError] = useState('');
  const [symbolQuery, setSymbolQuery] = useState('');
  const [symbolResults, setSymbolResults] = useState<MarketSymbol[]>([]);
  const [symbolBusy, setSymbolBusy] = useState(false);
  const [watchlist, setWatchlist] = useState<string[]>(['BTCUSDT', 'ETHUSDT']);
  const [smcSymbol, setSmcSymbol] = useState('BTCUSDT');
  const [smcCategory, setSmcCategory] = useState<BybitCategory>('linear');
  const [smcTimeframe, setSmcTimeframe] = useState<'30' | '60'>('60');
  const [smcAnalysis, setSmcAnalysis] = useState<SMCResponse | null>(null);
  const [smcBusy, setSmcBusy] = useState(false);
  const [smcError, setSmcError] = useState('');
  const [smcToolEnabled, setSmcToolEnabled] = useState(false);
  const [chatSmcResult, setChatSmcResult] = useState<SMCResponse | null>(null);
  const [analysisHistory, setAnalysisHistory] = useState<Record<string, unknown>[]>([]);
  const [analysisQuery, setAnalysisQuery] = useState('');
  const [historyCompareId, setHistoryCompareId] = useState('');
  const [historyError, setHistoryError] = useState('');

  const loadConversationList = useCallback(async () => {
    const response = await fetch('/api/conversations', { cache: 'no-store' });
    if (!response.ok) throw new Error(await responseError(response));
    const data = await response.json() as { conversations: Conversation[] };
    setConversations(data.conversations || []);
  }, []);

  useEffect(() => {
    let mounted = true;
    const config = supabaseBrowserConfiguration();
    setSupabaseReady(Boolean(config));
    if (config) {
      try {
        const client = getSupabaseBrowserClient();
        if (client) {
          void client.auth.getUser().then(async ({ data }: { data: { user: User | null } }) => {
            if (!mounted) return;
            setUser(data.user);
            if (data.user) {
              try { await loadConversationList(); } catch (error) { setChatError(error instanceof Error ? error.message : 'Could not load conversations.'); }
            }
          });
          const { data: { subscription } } = client.auth.onAuthStateChange((_event: AuthChangeEvent, session: Session | null) => {
            setUser(session?.user ?? null);
            if (session?.user) void loadConversationList().catch((error: unknown) => setChatError(error instanceof Error ? error.message : 'Could not load conversations.'));
            else { setConversations([]); setConversationId(null); setMessages([]); }
          });
          return () => { mounted = false; subscription.unsubscribe(); };
        }
      } catch {
        setAuthError('The Supabase URL or public key is invalid. Check the Supabase setup.');
      }
    }
    return () => { mounted = false; };
  }, [loadConversationList]);

  useEffect(() => {
    let mounted = true;
    void fetch('/api/providers', { cache: 'no-store' }).then((response) => response.json()).then(async (data) => {
      if (!mounted) return;
      const gemini = data.gemini as ProviderInfo;
      const openrouter = data.openrouter as ProviderInfo;
      setProviderInfo(gemini); setOpenRouterInfo(openrouter); setProvider('openrouter');
      setProviderNotice(gemini.configured ? `Optional · ${gemini.model || 'Gemini'}` : gemini.message || 'Setup needed');
      if (openrouter.configured && openrouter.model) {
        const response = await fetch('/api/models?provider=openrouter&freeOnly=true', { cache: 'no-store' });
        const modelData = await response.json() as { models?: ModelOption[]; freeFilterAvailable?: boolean };
        const freeModels = modelData.models || [];
        setModels(freeModels); setFreeFilterAvailable(modelData.freeFilterAvailable === true);
        setSelectedModel(freeModels.some((model) => model.id === openrouter.model) ? openrouter.model : '');
      } else {
        setSelectedModel('');
      }
    }).catch(() => { if (mounted) setProviderNotice('Status unavailable'); });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem('orion.market.watchlist');
      if (saved) {
        const parsed: unknown = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          const valid = parsed.filter((value): value is string => typeof value === 'string' && /^[A-Z0-9]{2,30}$/.test(value)).slice(0, 50);
          if (valid.length) { setWatchlist(valid); setMarketSymbol(valid[0]); }
        }
      }
    } catch { /* private browsing may disable local storage; current-session watchlist still works */ }
  }, []);

  useEffect(() => {
    try { window.localStorage.setItem('orion.market.watchlist', JSON.stringify(watchlist)); } catch { /* watchlist remains available for this session */ }
  }, [watchlist]);

  useEffect(() => {
    if (active !== 'Markets') return;
    let cancelled = false;
    setMarketBusy(true); setMarketError('');
    void fetch(`/api/markets/candles?category=${marketCategory}&symbol=${encodeURIComponent(marketSymbol)}&interval=${marketInterval}&limit=120`, { cache: 'no-store' })
      .then(async (response) => {
        const data = await response.json() as { candles?: Candle[]; lastUpdated?: string; stale?: boolean; message?: string };
        if (!response.ok) throw new Error(data.message || 'Could not load Bybit candles.');
        if (cancelled) return;
        setMarketCandles(data.candles || []); setMarketUpdated(data.lastUpdated || ''); setMarketStale(data.stale === true);
      }).catch((error: unknown) => { if (!cancelled) setMarketError(error instanceof Error ? error.message : 'Could not load Bybit candles.'); })
      .finally(() => { if (!cancelled) setMarketBusy(false); });
    return () => { cancelled = true; };
  }, [active, marketCategory, marketSymbol, marketInterval, marketRefreshToken]);

  useEffect(() => {
    if (active !== 'Markets') return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setSymbolBusy(true);
      void fetch(`/api/markets/symbols?category=${marketCategory}&q=${encodeURIComponent(symbolQuery)}`, { cache: 'no-store' })
        .then(async (response) => {
          const data = await response.json() as { symbols?: MarketSymbol[]; message?: string };
          if (!response.ok) throw new Error(data.message || 'Could not search Bybit symbols.');
          if (!cancelled) setSymbolResults(data.symbols || []);
        }).catch((error: unknown) => { if (!cancelled) setMarketError(error instanceof Error ? error.message : 'Could not search Bybit symbols.'); })
        .finally(() => { if (!cancelled) setSymbolBusy(false); });
    }, 250);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [active, marketCategory, symbolQuery]);

  const loadOpenRouterModels = useCallback(async (onlyFree = freeOnly): Promise<ModelOption[]> => {
    setModelsBusy(true);
    try {
      const response = await fetch(`/api/models?provider=openrouter${onlyFree ? '&freeOnly=true' : ''}`, { cache: 'no-store' });
      const data = await response.json() as { models?: ModelOption[]; freeFilterAvailable?: boolean; configured?: boolean; message?: string };
      setFreeFilterAvailable(data.freeFilterAvailable === true);
      setOpenRouterInfo((current) => ({ ...current, configured: data.configured === true, message: data.message }));
      if (!response.ok) throw new Error(data.message || 'Could not load OpenRouter models.');
      const loaded = data.models || [];
      setModels(loaded);
      setSelectedModel((selected) => loaded.some((model) => model.id === selected) ? selected : loaded[0]?.id || '');
      return loaded;
    } finally { setModelsBusy(false); }
  }, [freeOnly]);

  async function saveConversationSelection(nextProvider: ProviderId, modelId: string) {
    if (!conversationId || !modelId || (nextProvider !== 'gemini' && nextProvider !== 'openrouter')) return;
    const response = await fetch('/api/conversations', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: conversationId, provider: nextProvider, model: modelId }) });
    if (!response.ok) { setChatError(await responseError(response)); return; }
    const data = await response.json() as { conversation: Conversation };
    setConversations((items) => items.map((item) => item.id === data.conversation.id ? data.conversation : item));
  }

  async function changeProvider(nextProvider: ProviderId) {
    setProvider(nextProvider); setModelSearch(''); setChatError('');
    if (nextProvider === 'gemini') {
      const modelId = providerInfo.model || '';
      setSelectedModel(modelId);
      if (modelId) await saveConversationSelection(nextProvider, modelId);
    } else if (nextProvider === 'openrouter') {
      setSelectedModel(''); setFreeOnly(false);
      try {
        const loaded = await loadOpenRouterModels(false);
        const first = loaded[0]?.id || '';
        setSelectedModel(first);
        if (first) await saveConversationSelection(nextProvider, first);
      } catch (error) { setChatError(error instanceof Error ? error.message : 'OpenRouter model catalogue is unavailable.'); }
    } else {
      setSelectedModel('');
    }
  }

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthBusy(true); setAuthError(''); setAuthNotice('');
    const client = getSupabaseBrowserClient();
    if (!client) { setAuthError('Configure Supabase URL and public key in .env.local, then restart the app.'); setAuthBusy(false); return; }
    try {
      if (authMode === 'signin') {
        const { error } = await client.auth.signInWithPassword({ email: authEmail.trim(), password: authPassword });
        if (error) throw error;
        setAuthNotice('Signed in. Loading your private history…');
      } else {
        const { data, error } = await client.auth.signUp({ email: authEmail.trim(), password: authPassword });
        if (error) throw error;
        if (!data.session) setAuthNotice('Account created. Check your email to confirm it, then sign in here.');
        else setAuthNotice('Account created. Loading your private history…');
      }
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Authentication failed. Please try again.');
    } finally { setAuthBusy(false); }
  }

  async function signOut() {
    const client = getSupabaseBrowserClient();
    if (client) await client.auth.signOut();
    setUser(null); setConversationId(null); setMessages([]); setAttachedImage(null); setProvider('openrouter'); setSelectedModel(openRouterInfo.model || ''); setChatTitle('New conversation');
  }

  async function openConversation(conversation: Conversation) {
    setChatError(''); setFailedPrompt(null); setLoading(false);
    try {
      const response = await fetch(`/api/conversations?id=${encodeURIComponent(conversation.id)}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(await responseError(response));
      const data = await response.json() as { conversation: Conversation & { messages: Array<{ id: string; role: 'user' | 'assistant'; content: string; assistant_mode?: Mode }> } };
      if (data.conversation.provider === 'openrouter') await loadOpenRouterModels(false);
      setProvider(data.conversation.provider); setSelectedModel(data.conversation.model_id || providerInfo.model || '');
      setFreeOnly(false); setModelSearch('');
      setConversationId(data.conversation.id);
      setChatTitle(data.conversation.title);
      setMessages(data.conversation.messages.map((item) => ({ id: item.id, role: item.role, text: item.content })));
      const lastMode = data.conversation.messages.at(-1)?.assistant_mode; if (lastMode && lastMode in modeNames) setMode(lastMode);
      setActive('AI Chat'); setDrawer(false);
    } catch (error) { setChatError(error instanceof Error ? error.message : 'Could not open this conversation.'); }
  }

  function newConversation() {
    abortRef.current?.abort(); abortRef.current = null;
    setConversationId(null); setMessages([]); setAttachedImage(null); setProvider('openrouter'); setSelectedModel(openRouterInfo.model || ''); setChatTitle('New conversation'); setDraft(''); setChatError(''); setFailedPrompt(null); setLoading(false); setChatSmcResult(null); setSmcToolEnabled(false); setActive('AI Chat'); setDrawer(false);
  }

  async function renameConversation(item: Conversation) {
    const title = window.prompt('Rename conversation', item.title)?.trim();
    if (!title || title === item.title) return;
    const response = await fetch('/api/conversations', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: item.id, title }) });
    if (!response.ok) { setChatError(await responseError(response)); return; }
    const data = await response.json() as { conversation: Conversation };
    setConversations((items) => items.map((entry) => entry.id === item.id ? data.conversation : entry));
    if (conversationId === item.id) setChatTitle(data.conversation.title);
  }

  async function deleteConversation(item: Conversation) {
    if (!window.confirm(`Delete “${item.title}” and its messages?`)) return;
    const response = await fetch(`/api/conversations?id=${encodeURIComponent(item.id)}`, { method: 'DELETE' });
    if (!response.ok) { setChatError(await responseError(response)); return; }
    setConversations((items) => items.filter((entry) => entry.id !== item.id));
    if (conversationId === item.id) newConversation();
  }

  async function runSmcAnalysis() {
    setSmcBusy(true); setSmcError('');
    try {
      const response = await fetch('/api/smc/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ symbol: smcSymbol, category: smcCategory, timeframe: smcTimeframe }) });
      const data = await response.json() as SMCResponse & { message?: string };
      if (!response.ok) throw new Error(data.message || 'Could not analyze current market data.');
      setSmcAnalysis(data);
    } catch (error) { setSmcError(error instanceof Error ? error.message : 'SMC analysis failed.'); }
    finally { setSmcBusy(false); }
  }

  async function loadAnalysisHistory() {
    setHistoryError('');
    try { const response=await fetch(`/api/smc/analyses?q=${encodeURIComponent(analysisQuery)}`,{cache:'no-store'}); const data=await response.json() as {analyses?:Record<string,unknown>[];message?:string}; if(!response.ok)throw new Error(data.message||'Could not load analysis history.'); setAnalysisHistory(data.analyses||[]); }
    catch(error){setHistoryError(error instanceof Error?error.message:'Could not load analysis history.');}
  }
  function reopenAnalysis(item: Record<string,unknown>) {
    const candles=item.candle_snapshot as SMCResponse['candles']; const analysis=item.findings as SMCAssessment;
    if(!analysis||!candles){setHistoryError('This saved record is missing its reproducible candle snapshot.');return;}
    setSmcSymbol(String(item.symbol||analysis.symbol)); setSmcCategory(String(item.market_category||'linear') as BybitCategory); setSmcTimeframe(String(item.timeframe||analysis.timeframe) as '30'|'60');
    setSmcAnalysis({analysis,candles,source:'Saved Bybit candle snapshot',lastSuccessfulUpdate:String(item.last_market_update||''),strategyProfile:{id:String(item.strategy_profile_id||'snapshot'),name:String(item.strategy_name||'Saved profile'),version:Number(item.strategy_version)||1,settings:item.strategy_settings as {swingLeft:number;swingRight:number}},engineVersion:String(item.engine_version||'unknown'),savedAnalysisId:String(item.id)});
  }

  async function handleImageSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const allowed = ['image/jpeg', 'image/png', 'image/webp'] as const;
    if (!allowed.includes(file.type as typeof allowed[number])) { setChatError('Use a JPEG, PNG, or WebP image. HEIC and GIF are not supported yet.'); return; }
    if (file.size > 4 * 1024 * 1024) { setChatError('This image is over 4 MB. Choose a smaller image and try again.'); return; }
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('Orion could not read this image file.'));
        reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Orion could not decode this image file.'));
        reader.readAsDataURL(file);
      });
      const comma = dataUrl.indexOf(',');
      if (comma < 0) throw new Error('Orion could not decode this image file.');
      setAttachedImage({ name: file.name.slice(0, 180), mimeType: file.type as PendingImage['mimeType'], data: dataUrl.slice(comma + 1), dataUrl });
      setChatError('');
    } catch (error) { setChatError(error instanceof Error ? error.message : 'Orion could not read this image file.'); }
  }

  async function sendMessage(text = draft, retry = false) {
    const value = text.trim();
    const image = attachedImage;
    if ((!value && !image) || loading) return;
    const messageText = value || `[Please analyze the attached image: ${image?.name || 'image'}.]`;
    if (!user) { setChatError('Sign in to use private, persistent AI chat.'); return; }
    if (provider !== 'gemini' && provider !== 'openrouter') {
      setChatError(`${providerNames[provider]} is not configured yet.`);
      return;
    }
    if (provider === 'openrouter' && !openRouterInfo.configured) {
      setChatError(openRouterInfo.message || 'OpenRouter is not configured. Add OPENROUTER_API_KEY on the server.');
      return;
    }
    if (!selectedModel) { setChatError('Select an available model before sending.'); return; }
    if (provider === 'gemini' && !providerInfo.configured) {
      setChatError('Gemini is not validated. Check GEMINI_API_KEY and GEMINI_MODEL on the server. Paid access remains disabled; only the configured verified free-tier model is allowed.');
      return;
    }
    setChatError(''); setFailedPrompt(null); setDraft(''); setAttachedImage(null); setLoading(true); setChatSmcResult(null);
    const requestId = ++activeRequestRef.current;
    let id = conversationId;
    try {
      if (!id) {
        const title = messageText.length > 80 ? `${messageText.slice(0, 77)}…` : messageText;
        const createResponse = await fetch('/api/conversations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, provider, model: selectedModel }) });
        if (!createResponse.ok) throw new Error(await responseError(createResponse));
        const created = (await createResponse.json() as { conversation: Conversation }).conversation;
        id = created.id;
        setConversationId(created.id); setChatTitle(created.title); setConversations((items) => [created, ...items.filter((item) => item.id !== created.id)]);
      }
      if (!retry) setMessages((items) => [...items, { role: 'user', text: value, ...(image ? { imageDataUrl: image.dataUrl, imageName: image.name } : {}) }, { role: 'assistant', text: '', status: 'loading' }]);
      else setMessages((items) => [...items, { role: 'assistant', text: '', status: 'loading' }]);
      const controller = new AbortController(); abortRef.current = controller;
      const response = await fetch('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' }, signal: controller.signal,
        body: JSON.stringify({ conversationId: id, message: messageText, ...(image ? { image: { mimeType: image.mimeType, data: image.data, name: image.name } } : {}), mode, provider, model: selectedModel, retry, ...(smcToolEnabled ? { smcRequest: { symbol: smcSymbol, category: smcCategory, timeframe: smcTimeframe } } : {}) }),
      });
      if (!response.ok) throw new Error(await responseError(response));
      if (!response.body) throw new Error('The server returned no response stream. Try again.');
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ''; let eventName = ''; let streamError = ''; let streamDone = false;
      const consumeEvent = (block: string) => {
        const lines = block.split(/\r?\n/); eventName = '';
        let dataText = '';
        for (const line of lines) { if (line.startsWith('event:')) eventName = line.slice(6).trim(); else if (line.startsWith('data:')) dataText += line.slice(5).trim(); }
        if (!dataText) return;
        try {
          const payload = JSON.parse(dataText) as { text?: string; message?: string; analysis?: SMCAssessment; source?: string; lastSuccessfulUpdate?: string; candles?:SMCResponse['candles'] };
          if (eventName === 'delta' && typeof payload.text === 'string') {
            setMessages((items) => { const next = [...items]; const last = next[next.length - 1]; if (last?.role === 'assistant') next[next.length - 1] = { ...last, text: last.text + payload.text, status: 'loading' }; return next; });
          } else if (eventName === 'smc-result' && payload.analysis) {
            if(payload.candles)setChatSmcResult({ analysis: payload.analysis, candles:payload.candles, source: payload.source || 'Bybit V5 public REST', lastSuccessfulUpdate: payload.lastSuccessfulUpdate || '' });
          } else if (eventName === 'error') streamError = payload.message || 'The selected provider could not complete this response.';
          else if (eventName === 'done') streamDone = true;
        } catch { streamError = 'The server returned malformed stream data. Try again.'; }
      };
      while (true) {
        const { done, value: chunk } = await reader.read();
        buffer += decoder.decode(chunk, { stream: !done });
        const events = buffer.split(/\r?\n\r?\n/); buffer = events.pop() || '';
        events.forEach(consumeEvent);
        if (done) break;
      }
      if (buffer.trim()) consumeEvent(buffer);
      if (requestId !== activeRequestRef.current) return;
      if (!streamError && !streamDone) streamError = 'The AI stream ended before Orion received a completion signal. Your message is preserved; retry or switch to another available model.';
      if (streamError) {
        setChatError(streamError); setFailedPrompt(value);
        setMessages((items) => { const next = [...items]; const last = next[next.length - 1]; if (last?.role === 'assistant') { if (last.text) next[next.length - 1] = { ...last, status: 'error' }; else next.pop(); } return next; });
      } else {
        setMessages((items) => { const next = [...items]; const last = next[next.length - 1]; if (last?.role === 'assistant') next[next.length - 1] = { ...last, status: undefined }; return next; });
        void loadConversationList().catch(() => {});
      }
    } catch (error) {
      if (requestId !== activeRequestRef.current) return;
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setChatError(error instanceof Error ? error.message : 'The request failed. Please retry.'); setFailedPrompt(null);
      setMessages((items) => { const next = [...items]; const last = next[next.length - 1]; if (last?.role === 'assistant' && last.status === 'loading') { if (last.text) next[next.length - 1] = { ...last, status: 'error' }; else next.pop(); } return next; });
    } finally {
      if (requestId === activeRequestRef.current) { setLoading(false); abortRef.current = null; }
    }
  }

  function stopGeneration() {
    if (!loading) return;
    activeRequestRef.current += 1;
    abortRef.current?.abort(); abortRef.current = null; setLoading(false); setChatError('Generation stopped. Any partial assistant text shown here was not saved.'); setFailedPrompt(messages.filter((item) => item.role === 'user').at(-1)?.text || null);
    setMessages((items) => { const next = [...items]; const last = next[next.length - 1]; if (last?.role === 'assistant' && last.status === 'loading') next[next.length - 1] = { ...last, status: 'stopped' }; return next; });
  }

  return <main className="app-shell">
    <aside className={`sidebar ${drawer ? 'sidebar-open' : ''}`}>
      <div className="brand-row"><div className="brand-mark"><Sparkles size={18}/></div><span className="brand-name">orion<span className="brand-dot">.</span></span><button className="icon-button collapse" aria-label="Close navigation" onClick={() => setDrawer(false)}><ChevronLeft size={17}/></button></div>
      <button className="new-chat" onClick={newConversation}><SquarePen size={16}/><span>New conversation</span><span className="shortcut">⌘ K</span></button>
      <div className="side-scroll">
        {nav.map((section) => <div className="nav-section" key={section.title}><div className="section-label">{section.title}</div>{section.items.map(({ name, icon: Icon }) => <button key={name} className={`nav-item ${active === name ? 'nav-active' : ''}`} onClick={() => { setActive(name); setDrawer(false); }}><Icon size={17}/><span>{name}</span>{name === 'AI Chat' && <span className="nav-live"/>}</button>)}</div>)}
        <div className="section-label recent-label">Recent conversations <MoreHorizontal size={15}/></div>
        {!user ? <div className="empty-recent">Sign in to load your history.</div> : conversations.length ? conversations.map((item) => <div className={`recent-entry ${conversationId === item.id ? 'recent-selected' : ''}`} key={item.id}><button className="recent-item" onClick={() => void openConversation(item)} title={item.title}>{item.title}</button><button className="recent-action" aria-label={`Rename ${item.title}`} title="Rename" onClick={() => void renameConversation(item)}><Pencil size={12}/></button><button className="recent-action" aria-label={`Delete ${item.title}`} title="Delete" onClick={() => void deleteConversation(item)}><Trash2 size={12}/></button></div>) : <div className="empty-recent">Your conversations will appear here.</div>}
      </div>
      <div className="sidebar-bottom"><button className="profile-row" onClick={() => user ? void signOut() : undefined}><div className="avatar">{user?.email?.slice(0, 1).toUpperCase() || 'O'}</div><div className="profile-meta"><b>{user?.email || 'Personal workspace'}</b><span>{user ? 'Signed in · tap to sign out' : supabaseReady ? 'Sign in to sync history' : 'Supabase setup needed'}</span></div>{user ? <LogOut size={15}/> : <MoreHorizontal size={17}/>}</button><button className="settings-link" onClick={() => setActive('Settings & Integrations')}><Settings2 size={16}/> Settings & integrations</button></div>
    </aside>
    {drawer && <button className="drawer-scrim" aria-label="Close menu" onClick={() => setDrawer(false)}/>}
    <section className="main-area">
      <header className="topbar"><div className="top-left"><button className="icon-button mobile-menu" aria-label="Open navigation" onClick={() => setDrawer(true)}><Menu size={19}/></button><div className="breadcrumb"><span>Workspace</span><ChevronRight size={14}/><strong>{active}</strong></div></div><div className="top-actions"><button className="icon-button notification" aria-label="Notifications"><Bell size={17}/><i/></button><button className="help-button"><CircleHelp size={16}/><span>Help</span></button></div></header>
      {active === 'AI Chat' ? <div className="chat-layout">
        <div className="chat-top"><div className="chat-heading"><div><div className="eyebrow"><span className="green-pip"/> PRIVATE WORKSPACE</div><h1>{messages.length ? chatTitle : 'Your trading copilot'}</h1><p>Think clearly. Trade your plan.</p></div><button className="icon-button chat-more" aria-label="New conversation" title="New conversation" onClick={newConversation}><MoreHorizontal size={20}/></button></div>
          <div className="chat-controls"><label className="select-wrap"><span className="provider-glyph">✳</span><select value={provider} onChange={(e) => void changeProvider(e.target.value as ProviderId)} aria-label="AI provider"><option value="gemini">Gemini</option><option value="openrouter">OpenRouter</option><option value="openai-compatible">OpenAI-compatible · unavailable</option><option value="deepseek-compatible">DeepSeek-compatible · unavailable</option></select><ChevronDown size={13}/></label><span className={`provider-state ${(provider === 'gemini' ? providerInfo.configured : provider === 'openrouter' ? openRouterInfo.configured : false) ? 'provider-ready' : ''}`} title={provider === 'gemini' ? providerNotice : openRouterInfo.message || ''}><i/>{provider === 'gemini' ? providerNotice : provider === 'openrouter' ? modelsBusy ? 'Loading models…' : openRouterInfo.configured ? 'Validated · OpenRouter' : openRouterInfo.message || 'Setup needed' : 'Not configured'}</span>{provider === 'openrouter' && <input className="model-search" type="search" placeholder="Find a model" aria-label="Search OpenRouter models" value={modelSearch} onChange={(e) => setModelSearch(e.target.value)}/>}<label className="select-wrap model-select-wrap"><span className="model-label">MODEL</span><select value={selectedModel} onChange={(e) => { setSelectedModel(e.target.value); void saveConversationSelection(provider, e.target.value); }} aria-label="AI model" disabled={provider === 'gemini' ? !providerInfo.model : provider !== 'openrouter' || models.length === 0}><option value="">Select model</option>{(provider === 'openrouter' ? models.filter((item) => !modelSearch || item.name.toLowerCase().includes(modelSearch.toLowerCase()) || item.id.toLowerCase().includes(modelSearch.toLowerCase())) : providerInfo.model ? [{ id: providerInfo.model, name: providerInfo.model, free: null, contextLength: null }] : []).map((item) => <option value={item.id} key={item.id}>{item.name}{item.free === true ? ' · Free' : item.free === false ? ' · Paid' : provider === 'openrouter' ? ' · Pricing unknown' : ''}</option>)}</select><ChevronDown size={13}/></label>{provider === 'openrouter' && freeFilterAvailable && <label className="free-filter"><input type="checkbox" checked={freeOnly} onChange={async (e) => { const next = e.target.checked; setFreeOnly(next); try { await loadOpenRouterModels(next); } catch (error) { setChatError(error instanceof Error ? error.message : 'Could not update model list.'); } }}/>Free models</label>}<span className="control-divider"/><label className="mode-select"><span>Mode</span><select value={mode} onChange={(e) => setMode(e.target.value as Mode)} aria-label="Assistant mode">{Object.entries(modeNames).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select><ChevronDown size={13}/></label></div>
        </div>
        <div className="conversation-area">
          {!user ? <div className="auth-gate"><div className="welcome-icon"><ShieldCheck size={22}/></div><h2>{supabaseReady ? 'Your private chat starts here.' : 'Connect Supabase to continue.'}</h2><p>{supabaseReady ? 'Sign in or create an account. Orion stores conversations under your account with row-level security.' : 'Set the Supabase project URL and public key in .env.local, apply the migration, then restart Orion.'}</p>{supabaseReady && <form className="auth-form" onSubmit={submitAuth}><div className="auth-tabs"><button type="button" className={authMode === 'signin' ? 'auth-tab auth-tab-active' : 'auth-tab'} onClick={() => { setAuthMode('signin'); setAuthError(''); setAuthNotice(''); }}>Sign in</button><button type="button" className={authMode === 'signup' ? 'auth-tab auth-tab-active' : 'auth-tab'} onClick={() => { setAuthMode('signup'); setAuthError(''); setAuthNotice(''); }}>Create account</button></div><input type="email" autoComplete="email" required placeholder="Email address" value={authEmail} onChange={(e) => setAuthEmail(e.target.value)}/><input type="password" autoComplete={authMode === 'signin' ? 'current-password' : 'new-password'} minLength={8} required placeholder="Password (at least 8 characters)" value={authPassword} onChange={(e) => setAuthPassword(e.target.value)}/><button className="auth-submit" type="submit" disabled={authBusy}>{authBusy ? <><LoaderCircle size={14} className="spin"/> Working…</> : authMode === 'signin' ? 'Sign in securely' : 'Create account'}</button>{authError && <div className="inline-error">{authError}</div>}{authNotice && <div className="inline-notice">{authNotice}</div>}</form>}</div> : messages.length === 0 ? <div className="welcome-block"><div className="welcome-icon"><BrainCircuit size={22}/></div><h2>Good to have you here.</h2><p>Bring a setup, a question, or a trade you’re reflecting on.<br className="desktop-break"/> We’ll follow the evidence and your rules.</p><div className="suggestion-grid">{suggestions.map(({ title, caption, icon: Icon, prompt }) => <button className="suggestion" key={title} onClick={() => void sendMessage(prompt)}><div className="suggestion-icon"><Icon size={17}/></div><span className="suggestion-copy"><b>{title}</b><small>{caption}</small></span><ArrowUpRight className="suggestion-arrow" size={15}/></button>)}</div></div> : <div className="messages">{chatSmcResult && <SMCResultCard value={chatSmcResult} compact/>}{messages.map((message, index) => <div className={`message-row ${message.role}`} key={message.id || `${index}-${message.role}`}>
            {message.role === 'assistant' && <div className="assistant-avatar"><Sparkles size={15}/></div>}<div className="message-content"><div className="message-label">{message.role === 'assistant' ? 'ORION' : 'YOU'}{message.status === 'loading' && <LoaderCircle size={11} className="spin message-spinner"/>}</div><p>{message.text || (message.status === 'loading' ? 'Thinking…' : '')}</p>{message.imageDataUrl && <img className="chat-image-preview" src={message.imageDataUrl} alt={message.imageName || 'Uploaded image'} />}{message.status === 'stopped' && <small className="partial-note">Generation stopped · partial text was not saved</small>}</div></div>)}</div>}
        </div>
        {chatError && user && <div className="chat-error" role="alert"><span>{chatError}</span>{failedPrompt && !loading && <button onClick={() => void sendMessage(failedPrompt, true)}><RotateCcw size={12}/> Retry</button>}<button className="dismiss-error" aria-label="Dismiss message" onClick={() => setChatError('')}><X size={13}/></button></div>}
        <div className="composer-wrap"><input ref={imageInputRef} className="visually-hidden-file" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void handleImageSelected(event)} /><div className="attachment-row"><span className="context-label">ADD CONTEXT</span><button onClick={() => setDraft((v) => v + (v ? ' ' : '') + 'BTCUSDT ')}>＋ Market</button><button onClick={() => setDraft((v) => v + (v ? ' ' : '') + '1H timeframe ')}>＋ Timeframe</button><button onClick={() => setDraft((v) => v + (v ? ' ' : '') + 'Journal review ')}>＋ Journal</button><button className={smcToolEnabled ? 'smc-tool-active' : ''} onClick={() => setSmcToolEnabled((enabled) => !enabled)}>＋ SMC tool {smcToolEnabled ? 'on' : ''}</button></div>{smcToolEnabled && <div className="smc-tool-controls"><label>Symbol<input value={smcSymbol} onChange={(event) => setSmcSymbol(event.target.value.toUpperCase())} maxLength={30}/></label><label>Market<select value={smcCategory} onChange={(event) => setSmcCategory(event.target.value as BybitCategory)}><option value="linear">Linear</option><option value="spot">Spot</option><option value="inverse">Inverse</option></select></label><label>Entry timeframe<select value={smcTimeframe} onChange={(event) => setSmcTimeframe(event.target.value as '30' | '60')}><option value="60">1H</option><option value="30">30M</option></select></label><small>Each send fetches Daily, 4H, 1H and 30M candles from Bybit before asking {provider === 'openrouter' ? 'OpenRouter' : 'Gemini'} to explain the deterministic result.</small></div>}<div className="composer"><textarea rows={1} placeholder={user ? provider === 'openai-compatible' || provider === 'deepseek-compatible' ? `${providerNames[provider]} is not configured…` : 'Ask Orion anything about your trading…' : 'Sign in to start a private conversation…'} value={draft} disabled={!user || loading} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendMessage(); } }} /><div className="composer-tools"><button type="button" className="attach-button" aria-label="Attach image" title="Attach a JPEG, PNG, or WebP image (max 4 MB)" disabled={!user || loading} onClick={() => imageInputRef.current?.click()}><Plus size={19}/></button><span className="composer-hint">{provider === 'openrouter' ? 'Responses stream from the selected OpenRouter model.' : 'Responses stream from Gemini.'} Verify trading analysis.</span>{loading ? <button className="send-button stop-button" aria-label="Stop generation" title="Stop generation" onClick={stopGeneration}><StopCircle size={16}/></button> : <button className="send-button" aria-label="Send message" onClick={() => void sendMessage()} disabled={(!draft.trim() && !attachedImage) || !user}><Send size={15}/></button>}</div></div><div className="composer-foot"><span><ShieldCheck size={12}/> Your workspace is private</span><span>ENTER TO SEND <kbd>↵</kbd></span></div></div>
      </div> : active === 'Markets' ? <div className="market-page">
        <div className="market-heading"><div><div className="eyebrow"><span className="green-pip"/> BYBIT PUBLIC MARKET DATA</div><h1>Crypto markets</h1><p>Public candle data · no trading credentials</p></div><button className="market-refresh" onClick={() => setMarketRefreshToken((value) => value + 1)} disabled={marketBusy}><RotateCcw size={14}/> Refresh</button></div>
        <div className="market-layout"><section className="market-sidebar"><label className="market-label">MARKET TYPE<select value={marketCategory} onChange={(event) => setMarketCategory(event.target.value as BybitCategory)}><option value="linear">Linear contracts</option><option value="spot">Spot</option><option value="inverse">Inverse contracts</option></select></label><label className="market-label">SEARCH SYMBOLS<input type="search" value={symbolQuery} placeholder="Search BTC, ETH…" onChange={(event) => setSymbolQuery(event.target.value)}/></label><div className="symbol-results"><div className="market-subtitle">{symbolBusy ? 'Searching…' : 'SEARCH RESULTS'}</div>{symbolResults.map((result) => <button key={result.symbol} className="symbol-result" onClick={() => { setMarketSymbol(result.symbol); setWatchlist((items) => items.includes(result.symbol) ? items : [result.symbol, ...items].slice(0, 50)); }}><span><b>{result.symbol}</b><small>{result.baseCoin}{result.quoteCoin ? ` / ${result.quoteCoin}` : ''}</small></span><span>{watchlist.includes(result.symbol) ? '✓' : '+'}</span></button>)}</div><div className="watchlist"><div className="market-subtitle">WATCHLIST · {watchlist.length}</div>{watchlist.map((symbol) => <div key={symbol} className={`watchlist-row ${marketSymbol === symbol ? 'watchlist-active' : ''}`}><button onClick={() => setMarketSymbol(symbol)}>{symbol}</button><button aria-label={`Remove ${symbol} from watchlist`} title="Remove from watchlist" onClick={() => setWatchlist((items) => { const next = items.filter((item) => item !== symbol); if (marketSymbol === symbol && next[0]) setMarketSymbol(next[0]); return next; })}>×</button></div>)}</div></section>
          <section className="market-data"><div className="market-toolbar"><div className="market-selected"><b>{marketSymbol}</b><span>{marketCategory.toUpperCase()} · Bybit V5</span></div><label className="market-label inline-market-label">TIMEFRAME<select value={marketInterval} onChange={(event) => setMarketInterval(event.target.value as BybitInterval)}>{[['1','1m'],['3','3m'],['5','5m'],['15','15m'],['30','30m'],['60','1H'],['120','2H'],['240','4H'],['360','6H'],['720','12H'],['D','1D'],['W','1W'],['M','1M']].map(([value,label]) => <option value={value} key={value}>{label}</option>)}</select></label></div>
            <div className={`market-feed-status ${marketStale ? 'market-stale' : ''}`}><span className={marketStale ? 'amber-pip' : 'green-pip'}/>{marketBusy ? 'Loading candles…' : marketError ? 'Feed unavailable' : marketStale ? 'Stale data · inspect timestamps' : 'Public feed connected'}{marketUpdated && <small>Last successful update {new Date(marketUpdated).toLocaleString()}</small>}</div>
            {marketError && <div className="inline-error market-error" role="alert">{marketError}</div>}
            {marketStale && <div className="market-warning">The latest candle is older than expected for this timeframe. Verify its timestamp before using it.</div>}
            <div className="candle-table-wrap"><table className="candle-table"><thead><tr><th>Timestamp (local)</th><th>Open</th><th>High</th><th>Low</th><th>Close</th><th>Volume</th><th>State</th></tr></thead><tbody>{marketCandles.slice().reverse().map((candle) => <tr key={candle.startTime}><td>{new Date(candle.startTime).toLocaleString()}</td><td>{candle.open}</td><td>{candle.high}</td><td>{candle.low}</td><td>{candle.close}</td><td>{candle.volume}</td><td><span className={candle.closed ? 'candle-closed' : 'candle-open'}>{candle.closed ? 'Closed' : 'Forming'}</span></td></tr>)}</tbody></table>{!marketBusy && !marketError && marketCandles.length === 0 && <div className="market-empty">No candles to show.</div>}</div>
          </section></div>
      </div> : active === 'Strategy Settings' ? <StrategySettingsPage signedIn={Boolean(user)}/> : active === 'Trading Tools' ? <TradingToolsPage/> : active === 'Trading Journal' ? <JournalPage signedIn={Boolean(user)}/> : active === 'SMC Scanner' || active === 'Chart Analyzer' ? <div className="smc-page">
        <div className="market-heading"><div><div className="eyebrow"><span className="green-pip"/> DETERMINISTIC · BYBIT PUBLIC DATA</div><h1>{active === 'SMC Scanner' ? 'SMC Scanner' : 'Market Analysis'}</h1><p>Rule-based findings from verified candles. No AI-generated price levels.</p></div><button className="return-chat" onClick={() => { setSmcToolEnabled(true); setSmcCategory(marketCategory); setSmcTimeframe(smcTimeframe); setSmcSymbol(smcSymbol); setDraft(`Explain the deterministic SMC result for ${smcSymbol} on ${smcTimeframe === '30' ? '30M' : '1H'} and identify missing confirmations.`); setActive('AI Chat'); }}><MessageSquare size={15}/> Explain with AI</button></div>
        <form className="smc-query" onSubmit={(event) => { event.preventDefault(); void runSmcAnalysis(); }}><label>SYMBOL<input value={smcSymbol} onChange={(event) => setSmcSymbol(event.target.value.toUpperCase())} maxLength={30} required/></label><label>MARKET<select value={smcCategory} onChange={(event) => setSmcCategory(event.target.value as BybitCategory)}><option value="linear">Linear contracts</option><option value="spot">Spot</option><option value="inverse">Inverse contracts</option></select></label><label>CONFIRMATION TIMEFRAME<select value={smcTimeframe} onChange={(event) => setSmcTimeframe(event.target.value as '30' | '60')}><option value="60">1H</option><option value="30">30M</option></select></label><button className="market-refresh" type="submit" disabled={smcBusy}>{smcBusy ? <><LoaderCircle size={14} className="spin"/> Analyzing…</> : <><Search size={14}/> Analyze market</>}</button></form>
        <p className="smc-timeframe-note">Analysis loads Daily and 4H context plus both 1H and 30M confirmation candles; selection chooses the active entry timeframe. Higher-timeframe bars are aligned only after close.</p>
        {smcError && <div className="inline-error market-error" role="alert">{smcError}</div>}
        {smcAnalysis ? <>{active==='Chart Analyzer'&&<SMCCandlestickChart analysis={smcAnalysis.analysis} candles={smcTimeframe==='30'?smcAnalysis.candles.thirtyMinute:smcAnalysis.candles.oneHour} timeframe={smcTimeframe==='30'?'30M':'1H'} settings={smcAnalysis.strategyProfile?.settings} lastSuccessfulUpdate={smcAnalysis.lastSuccessfulUpdate}/>}<SMCResultCard value={smcAnalysis}/>{smcAnalysis.strategyProfile&&<p className="smc-timeframe-note">Strategy {smcAnalysis.strategyProfile.name} v{smcAnalysis.strategyProfile.version} · Engine {smcAnalysis.engineVersion||'unknown'} · saved analysis {smcAnalysis.savedAnalysisId||'not persisted (sign in and configure Supabase)'}</p>}{smcAnalysis.historyWarning&&<div className="market-warning">{smcAnalysis.historyWarning}</div>}</> : <div className="smc-empty"><div className="welcome-icon"><Search size={20}/></div><b>Run a scan to inspect current structure</b><span>Live findings appear here only after the market-data service returns valid candles.</span></div>}
        <section className="feature-card history-card"><h2>Saved analysis history</h2><p>Each saved analysis keeps the candle snapshot, engine output, strategy version, and settings used. Reopening does not recalculate or overwrite it.</p><div className="history-search"><input value={analysisQuery} onChange={e=>setAnalysisQuery(e.target.value)} placeholder="Search symbol"/><button onClick={()=>void loadAnalysisHistory()}>Search history</button></div>{historyError&&<div className="inline-error">{historyError}</div>}<div className="history-list">{analysisHistory.map((item)=><article key={String(item.id)}><div><b>{String(item.symbol)} · {String(item.timeframe)} · {String(item.strategy_name)} v{String(item.strategy_version)}</b><small>{new Date(String(item.analysis_timestamp)).toLocaleString()} · {String((item.findings as SMCAssessment)?.state||'')} · {Array.isArray(item.smc_analysis_explanations)?item.smc_analysis_explanations.length:0} saved AI explanation(s)</small></div><button onClick={()=>reopenAnalysis(item)}>Reopen</button><label>Compare<input type="radio" name="history-compare" checked={historyCompareId===item.id} onChange={()=>setHistoryCompareId(String(item.id))}/></label></article>)}</div>{historyCompareId&&smcAnalysis&&<div className="history-compare"><b>Comparison with current analysis</b><span>Saved state: {String((analysisHistory.find(x=>x.id===historyCompareId)?.findings as SMCAssessment|undefined)?.state||'unavailable')} · Current state: {smcAnalysis.analysis.state}</span><span>Saved symbol/timeframe: {String(analysisHistory.find(x=>x.id===historyCompareId)?.symbol||'')} / {String(analysisHistory.find(x=>x.id===historyCompareId)?.timeframe||'')} · Current: {smcAnalysis.analysis.symbol} / {smcAnalysis.analysis.timeframe}</span></div>}</section>
      </div> : <div className="placeholder-page"><div className="welcome-icon"><Compass size={22}/></div><div className="eyebrow">ORION WORKSPACE</div><h1>{active}</h1><p>This area is part of your workspace. The first release is focused on persistent AI chat; other integrations will be added in later stages.</p><div className="placeholder-status"><span className="amber-pip"/> Integration not configured</div><button className="return-chat" onClick={() => setActive('AI Chat')}><MessageSquare size={15}/> Return to AI Chat</button></div>}
      <nav className="bottom-nav">{[{ name: 'Home', icon: LayoutDashboard }, { name: 'AI Chat', icon: MessageSquare }, { name: 'Markets', icon: TrendingUp }, { name: 'Journal', icon: FileText }].map(({ name, icon: Icon }) => <button key={name} onClick={() => setActive(name === 'Journal' ? 'Trading Journal' : name)} className={active === name || (name === 'Journal' && active === 'Trading Journal') ? 'bottom-active' : ''}><Icon size={18}/><span>{name}</span></button>)}</nav>
    </section>
  </main>;
}
