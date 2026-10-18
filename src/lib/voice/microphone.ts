export type MicrophoneFailure = 'denied' | 'unavailable' | 'unsupported';
export type MicrophoneResult = { ok: true } | { ok: false; reason: MicrophoneFailure };

type MediaDevicesLike = { getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream> };

/**
 * Preflights microphone access so the voice UI can show a clear permission state before
 * joining a room. Any granted stream is stopped immediately; LiveKit re-acquires the
 * microphone itself once the session starts.
 */
export async function requestMicrophoneAccess(mediaDevices?: MediaDevicesLike | null, constraints: MediaStreamConstraints = { audio: true }): Promise<MicrophoneResult> {
  const devices = mediaDevices ?? (typeof navigator !== 'undefined' ? (navigator.mediaDevices as MediaDevicesLike | undefined) : undefined);
  if (!devices || typeof devices.getUserMedia !== 'function') return { ok: false, reason: 'unsupported' };
  try {
    const stream = await devices.getUserMedia(constraints);
    stream.getTracks?.().forEach((track) => track.stop());
    return { ok: true };
  } catch (error) {
    const name = error && typeof error === 'object' && 'name' in error ? String((error as { name?: unknown }).name) : '';
    if (name === 'NotAllowedError' || name === 'SecurityError') return { ok: false, reason: 'denied' };
    return { ok: false, reason: 'unavailable' };
  }
}

export function microphoneFailureMessage(reason: MicrophoneFailure): string {
  if (reason === 'denied') return 'Microphone access was blocked. Allow microphone permission for this site in your browser, then retry — or continue in text chat.';
  if (reason === 'unavailable') return 'No usable microphone was found. Check that a microphone is connected and not in use by another app, then retry — or continue in text chat.';
  return 'This browser does not expose microphone access. Continue in text chat, or open Orion in a supported browser.';
}
