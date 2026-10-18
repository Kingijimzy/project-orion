'use client';

import { useEffect, useState } from 'react';
import { LiveKitRoom, RoomAudioRenderer, ControlBar, StartAudio, useRoomContext } from '@livekit/components-react';
import { RoomEvent } from 'livekit-client';
import { Mic, ShieldCheck, Radio, LoaderCircle, Headphones, AlertTriangle, MessageSquare, RefreshCw } from 'lucide-react';
import { microphoneFailureMessage, requestMicrophoneAccess } from '@/lib/voice/microphone';

type VoiceSession = { token: string; serverUrl: string; roomName: string; agentName: string; strategy?: { name: string; version: number } | null };
type ApiError = { message?: string };
type Phase = 'idle' | 'permission' | 'connecting' | 'connected' | 'reconnecting';

async function getError(response: Response) {
  try { return ((await response.json()) as ApiError).message || 'Could not start the voice session.'; }
  catch { return 'Could not start the voice session.'; }
}

/** Reports LiveKit's own reconnect lifecycle so the UI can show a live reconnecting state. */
function ConnectionMonitor({ onChange }: { onChange: (phase: 'connected' | 'reconnecting') => void }) {
  const room = useRoomContext();
  useEffect(() => {
    const onReconnecting = () => onChange('reconnecting');
    const onReconnected = () => onChange('connected');
    room.on(RoomEvent.Reconnecting, onReconnecting);
    room.on(RoomEvent.Reconnected, onReconnected);
    return () => {
      room.off(RoomEvent.Reconnecting, onReconnecting);
      room.off(RoomEvent.Reconnected, onReconnected);
    };
  }, [room, onChange]);
  return null;
}

export function VoiceAssistantPanel({ onOpenTextChat }: { onOpenTextChat?: () => void } = {}) {
  const [session, setSession] = useState<VoiceSession | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');

  async function startSession() {
    setBusy(true); setError(''); setNotice(''); setPhase('permission');
    try {
      const mic = await requestMicrophoneAccess();
      if (!mic.ok) { setPhase('idle'); setError(microphoneFailureMessage(mic.reason)); return; }
      setPhase('connecting');
      const response = await fetch('/api/livekit/token', { method: 'POST', cache: 'no-store' });
      if (!response.ok) throw new Error(await getError(response));
      const data = await response.json() as VoiceSession;
      if (!data.token || !data.serverUrl || !data.roomName) throw new Error('LiveKit returned an incomplete session.');
      setSession(data);
      setNotice(data.strategy ? `Connecting with your “${data.strategy.name}” strategy. The voice agent must also be running in LiveKit.` : 'Connecting securely. The voice agent must also be running in LiveKit.');
    } catch (cause) {
      setPhase('idle');
      setError(cause instanceof Error ? cause.message : 'Could not start the voice session.');
    } finally { setBusy(false); }
  }

  function endSession(nextNotice: string) {
    setSession(null); setPhase('idle'); setError(''); setNotice(nextNotice);
  }

  const stateLabel = session
    ? phase === 'reconnecting' ? 'Reconnecting to voice room…'
      : phase === 'connected' ? 'Connected to voice room'
        : 'Connecting to voice room…'
    : phase === 'permission' ? 'Checking microphone permission…'
      : 'Ready when you are';

  return <div className="voice-page">
    <header className="voice-heading">
      <div><div className="eyebrow"><span className="green-pip"/> LIVEKIT · REAL-TIME VOICE</div><h1>Talk to Orion</h1><p>Speak naturally, ask follow-up questions, and hear Orion respond while you keep your charts nearby.</p></div>
    </header>
    <section className="voice-card">
      <div className="voice-orb"><div className="voice-orb-inner"><Radio size={30}/></div></div>
      <div className="voice-state">{stateLabel}</div>
      <p className="voice-description">{session ? `Allow microphone access if prompted. The ${session.agentName} worker must be running for spoken replies.${session.strategy ? ` This session starts from your “${session.strategy.name}” v${session.strategy.version} strategy.` : ''}` : 'Start a private voice room. Your browser will ask for microphone permission when the session begins.'}</p>
      {!session ? <div className="voice-actions"><button className="voice-primary" onClick={() => void startSession()} disabled={busy}>{busy ? <><LoaderCircle size={16} className="spin"/> Preparing voice session…</> : <><Mic size={16}/> Start talking</>}</button>{onOpenTextChat && <button className="voice-secondary" onClick={onOpenTextChat}><MessageSquare size={15}/> Use text chat instead</button>}</div> :
        <LiveKitRoom token={session.token} serverUrl={session.serverUrl} connect audio video={false}
          onConnected={() => { setPhase('connected'); setError(''); setNotice(`Connected to LiveKit. Waiting for ${session.agentName} to join.`); }}
          onError={(cause) => { setPhase('idle'); setError(`Could not connect to LiveKit: ${cause.message}`); setSession(null); }}
          onMediaDeviceFailure={() => { setPhase('idle'); setError('Orion could not use your microphone (device error). Check that a microphone is connected and permitted, then retry — or continue in text chat.'); }}
          onDisconnected={() => endSession('Voice session ended.')}>
          <ConnectionMonitor onChange={(next) => setPhase(next)} />
          <div className="voice-live-status"><span className={phase === 'reconnecting' ? 'voice-reconnect-pip' : 'green-pip'}/> {phase === 'reconnecting' ? 'Reconnecting…' : phase === 'connected' ? `Connected · waiting for ${session.agentName}` : 'Joining LiveKit room…'}</div>
          <RoomAudioRenderer/>
          <StartAudio label="Enable Orion audio"/>
          <ControlBar controls={{ microphone: true, camera: false, screenShare: false, chat: false, leave: true }} />
          <div className="voice-actions"><button className="voice-secondary" onClick={() => endSession('Voice session ended.')}><Headphones size={15}/> End voice session</button>{onOpenTextChat && <button className="voice-secondary" onClick={onOpenTextChat}><MessageSquare size={15}/> Continue in text chat</button>}</div>
        </LiveKitRoom>}
      {notice && <div className="voice-notice"><ShieldCheck size={14}/><span>{notice}</span></div>}
      {error && <div className="voice-error" role="alert"><AlertTriangle size={14}/><span>{error}</span></div>}
      {error && !session && <div className="voice-actions"><button className="voice-secondary" onClick={() => void startSession()} disabled={busy}>{busy ? <><LoaderCircle size={14} className="spin"/> Retrying…</> : <><RefreshCw size={14}/> Retry connection</>}</button>{onOpenTextChat && <button className="voice-secondary" onClick={onOpenTextChat}><MessageSquare size={15}/> Continue in text chat</button>}</div>}
    </section>
    <section className="voice-card voice-setup">
      <h2>Free-to-test setup</h2>
      <p>The web interface and token endpoint do not require a paid API. For an actual speaking assistant, configure a LiveKit Cloud project and run the Orion voice-agent worker. LiveKit's free Build plan currently includes limited monthly inference credits; it is free to test within that allowance, not unlimited.</p>
      <ol><li>Create a free LiveKit Cloud project and copy its server URL and API credentials.</li><li>Add the three LiveKit server variables to your deployment environment. Never put the API secret in browser code.</li><li>Run the voice agent using the instructions in <code>voice-agent/README.md</code>.</li></ol>
      <p className="voice-caveat">The voice agent is an assistant, not an execution bot. It must not place trades, and it should not claim to know current prices unless connected to Orion's verified market-data tools.</p>
    </section>
  </div>;
}
