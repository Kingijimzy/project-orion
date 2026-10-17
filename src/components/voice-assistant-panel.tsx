'use client';

import { useState } from 'react';
import { LiveKitRoom, RoomAudioRenderer, ControlBar, StartAudio } from '@livekit/components-react';
import { Mic, ShieldCheck, Radio, LoaderCircle, Headphones, AlertTriangle } from 'lucide-react';

type VoiceSession = { token: string; serverUrl: string; roomName: string; agentName: string };
type ApiError = { message?: string };

async function getError(response: Response) {
  try { return ((await response.json()) as ApiError).message || 'Could not start the voice session.'; }
  catch { return 'Could not start the voice session.'; }
}

export function VoiceAssistantPanel() {
  const [session, setSession] = useState<VoiceSession | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [connected, setConnected] = useState(false);

  async function startSession() {
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/livekit/token', { method: 'POST', cache: 'no-store' });
      if (!response.ok) throw new Error(await getError(response));
      const data = await response.json() as VoiceSession;
      if (!data.token || !data.serverUrl || !data.roomName) throw new Error('LiveKit returned an incomplete session.');
      setConnected(false);
      setSession(data);
      setNotice('Connecting securely. The voice agent must also be running in LiveKit.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not start the voice session.');
    } finally { setBusy(false); }
  }

  return <div className="voice-page">
    <header className="voice-heading">
      <div><div className="eyebrow"><span className="green-pip"/> LIVEKIT · REAL-TIME VOICE</div><h1>Talk to Orion</h1><p>Speak naturally, ask follow-up questions, and hear Orion respond while you keep your charts nearby.</p></div>
    </header>
    <section className="voice-card">
      <div className="voice-orb"><div className="voice-orb-inner"><Radio size={30}/></div></div>
      <div className="voice-state">{session ? connected ? 'Connected to voice room' : 'Connecting to voice room…' : 'Ready when you are'}</div>
      <p className="voice-description">{session ? `Allow microphone access if prompted. The ${session.agentName} worker must be running for spoken replies.` : 'Start a private voice room. Your browser will ask for microphone permission when the session begins.'}</p>
      {!session ? <button className="voice-primary" onClick={() => void startSession()} disabled={busy}>{busy ? <><LoaderCircle size={16} className="spin"/> Preparing voice session…</> : <><Mic size={16}/> Start talking</>}</button> :
        <LiveKitRoom token={session.token} serverUrl={session.serverUrl} connect audio video={false}
          onConnected={() => { setConnected(true); setError(''); setNotice(`Connected to LiveKit. Waiting for ${session.agentName} to join.`); }}
          onError={(cause) => { setConnected(false); setError(`Could not connect to LiveKit: ${cause.message}`); setSession(null); }}
          onDisconnected={() => { setConnected(false); setSession(null); setNotice('Voice session ended.'); }}>
          <div className="voice-live-status"><span className="green-pip"/> {connected ? `Connected · waiting for ${session.agentName}` : 'Joining LiveKit room…'}</div>
          <RoomAudioRenderer/>
          <StartAudio label="Enable Orion audio"/>
          <ControlBar controls={{ microphone: true, camera: false, screenShare: false, chat: false, leave: true }} />
          <button className="voice-secondary" onClick={() => setSession(null)}><Headphones size={15}/> End voice session</button>
        </LiveKitRoom>}
      {notice && <div className="voice-notice"><ShieldCheck size={14}/><span>{notice}</span></div>}
      {error && <div className="voice-error" role="alert"><AlertTriangle size={14}/><span>{error}</span></div>}
      {error && !session && <button className="voice-secondary" onClick={() => void startSession()} disabled={busy}>{busy ? 'Retrying…' : 'Retry connection'}</button>}
    </section>
    <section className="voice-card voice-setup">
      <h2>Free-to-test setup</h2>
      <p>The web interface and token endpoint do not require a paid API. For an actual speaking assistant, configure a LiveKit Cloud project and run the Orion voice-agent worker. LiveKit's free Build plan currently includes limited monthly inference credits; it is free to test within that allowance, not unlimited.</p>
      <ol><li>Create a free LiveKit Cloud project and copy its server URL and API credentials.</li><li>Add the three LiveKit server variables to your deployment environment. Never put the API secret in browser code.</li><li>Run the voice agent using the instructions in <code>voice-agent/README.md</code>.</li></ol>
      <p className="voice-caveat">The voice agent is an assistant, not an execution bot. It must not place trades, and it should not claim to know current prices unless connected to Orion's verified market-data tools.</p>
    </section>
  </div>;
}
