'use client';

import { useEffect, useRef, useState } from 'react';
import { Lang, useKiosk } from './KioskShell';

type Phase = 'idle' | 'listening' | 'transcribing';

const MAX_MS = 15000; // hard stop
const SILENCE_MS = 1300; // stop this long after the visitor stops talking
const NO_SPEECH_MS = 6000; // give up if nobody speaks

type DemoLine = { lang: Lang; question: string };
let demoStep = 0; // which scripted question the next tap plays; back to the first on idle reset

/**
 * Tap to speak. While listening, a live waveform covers the question bar; recording stops on its own
 * when the visitor pauses (or on a second tap). Audio goes to /api/transcribe → on-device Whisper.
 * In English mode the spoken language is detected, and onText receives it so the kiosk can switch.
 * Must be rendered inside a positioned container (the .askbar), which the waveform overlays.
 *
 * Scripted demo (server DEMO_MODE=1): no microphone and no sound. Each tap "hears" the next scripted question:
 * the waveform animates and the words appear as a live caption, then the question is asked.
 */
export default function VoiceButton({ onText, onStatus }: { onText: (t: string, lang: Lang) => void; onStatus: (s: string) => void }) {
  const { lang, t } = useKiosk();
  const [phase, setPhase] = useState<Phase>('idle');
  const [available, setAvailable] = useState(false);
  const [demo, setDemo] = useState<DemoLine[] | null>(null);
  const [caption, setCaption] = useState('');
  const canvas = useRef<HTMLCanvasElement>(null);
  const stopRef = useRef<() => void>(() => {});
  const cleanup = useRef<() => void>(() => {});

  useEffect(() => {
    fetch('/api/voice')
      .then((r) => r.json())
      .then((j) => {
        if (j.demo?.length) { setDemo(j.demo); setAvailable(true); }
        else setAvailable(!!j.stt && typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices);
      })
      .catch(() => setAvailable(false));
    const reset = () => { cleanup.current(); demoStep = 0; };
    window.addEventListener('kiosk-reset', reset);
    return () => { window.removeEventListener('kiosk-reset', reset); cleanup.current(); };
  }, []);

  /** Scripted demo: silently "hear" the next question — animated waveform, words typed in at speaking pace. */
  function startDemo(script: DemoLine[]) {
    const line = script[demoStep++ % script.length];
    window.speechSynthesis?.cancel();
    window.dispatchEvent(new Event('kiosk-stop-speaking'));
    const words = line.question.split(/\s+/);
    const dur = 0.4 * words.length + 0.6; // seconds of "speech"
    const history: number[] = [];
    let raf = 0, ended = false;
    const t0 = performance.now();

    const tick = () => {
      const t = (performance.now() - t0) / 1000;
      // Speech-like loudness: syllable pulses under a slower phrase envelope, quiet once the question is "said".
      history.push(t < dur ? 0.25 + 0.55 * Math.abs(Math.sin(t * 9) * Math.sin(t * 3.7)) : 0.02);
      if (history.length > 64) history.shift();
      draw(canvas.current, history);
      setCaption(words.slice(0, Math.min(words.length, Math.ceil((t / (dur * 0.9)) * words.length))).join(' '));
      if (t > dur + 0.3) return finish();
      raf = requestAnimationFrame(tick);
    };
    const finish = () => {
      if (ended) return;
      ended = true;
      cancelAnimationFrame(raf);
      setCaption(line.question);
      setPhase('transcribing');
      setTimeout(() => {
        setPhase('idle');
        setCaption('');
        onText(line.question, line.lang);
      }, 650);
    };
    stopRef.current = finish;
    cleanup.current = () => { ended = true; cancelAnimationFrame(raf); setPhase('idle'); setCaption(''); };

    setPhase('listening');
    onStatus('');
    raf = requestAnimationFrame(tick);
  }

  async function start() {
    if (demo) return startDemo(demo);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch {
      onStatus(t('micUnavailable'));
      return;
    }
    window.speechSynthesis?.cancel();
    window.dispatchEvent(new Event('kiosk-stop-speaking'));

    const rec = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);

    // Level meter + end-of-speech detection
    const ac = new AudioContext();
    const src = ac.createMediaStreamSource(stream);
    const an = ac.createAnalyser();
    an.fftSize = 1024;
    an.smoothingTimeConstant = 0.6;
    src.connect(an);
    const buf = new Float32Array(an.fftSize);
    const t0 = performance.now();
    let noise = 0.01, spoke = false, lastVoice = t0, raf = 0;
    const history: number[] = [];

    const tick = () => {
      an.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += v * v;
      const rms = Math.sqrt(sum / buf.length);
      const now = performance.now();
      if (now - t0 < 350) noise = Math.max(noise, rms * 0.9); // calibrate on room noise
      const voiced = rms > Math.max(noise * 2.5, 0.015);
      if (voiced) { spoke = true; lastVoice = now; }
      history.push(Math.min(1, rms / Math.max(noise * 8, 0.12)));
      if (history.length > 64) history.shift();
      draw(canvas.current, history);
      if ((spoke && now - lastVoice > SILENCE_MS) || now - t0 > MAX_MS || (!spoke && now - t0 > NO_SPEECH_MS)) return finish();
      raf = requestAnimationFrame(tick);
    };

    let ended = false;
    const release = () => {
      cancelAnimationFrame(raf);
      stream.getTracks().forEach((tr) => tr.stop());
      ac.close().catch(() => {});
    };
    const finish = () => {
      if (ended) return;
      ended = true;
      release();
      if (rec.state === 'recording') rec.stop();
    };
    stopRef.current = finish;
    cleanup.current = () => { ended = true; release(); rec.onstop = null; if (rec.state === 'recording') rec.stop(); setPhase('idle'); };

    rec.onstop = async () => {
      if (!spoke) { setPhase('idle'); onStatus(t('heardNothing')); return; }
      setPhase('transcribing');
      onStatus('');
      const fd = new FormData();
      fd.append('file', new Blob(chunks, { type: rec.mimeType || 'audio/webm' }), 'speech.webm');
      fd.append('lang', lang);
      try {
        const res = await fetch('/api/transcribe', { method: 'POST', body: fd });
        const j = await res.json();
        if (j.text) onText(j.text, (j.lang as Lang) || lang);
        else onStatus(j.error ? `${t('voiceFailed')} (${j.error})` : t('heardNothing'));
      } catch {
        onStatus(t('voiceFailed'));
      } finally {
        setPhase('idle');
      }
    };

    rec.start();
    setPhase('listening');
    onStatus('');
    raf = requestAnimationFrame(tick);
  }

  if (!available) return null;
  return (
    <>
      {phase !== 'idle' && (
        <div className={`voice-viz ${phase}${caption ? ' captioning' : ''}`} onClick={() => phase === 'listening' && stopRef.current()} aria-live="polite">
          <canvas ref={canvas} width={1200} height={120} aria-hidden />
          <span className="voice-label">
            {phase === 'listening' ? caption || t('listening') : demo ? caption : t('transcribing')}
          </span>
        </div>
      )}
      <button
        type="button"
        className={`btn round mic ${phase}`}
        onClick={() => (phase === 'listening' ? stopRef.current() : phase === 'idle' && start())}
        disabled={phase === 'transcribing'}
        aria-label={phase === 'listening' ? 'Stop recording' : 'Ask by voice'}
      >
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          {phase === 'listening' ? <rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor" /> : (
            <>
              <rect x="9" y="3" width="6" height="11" rx="3" />
              <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
            </>
          )}
        </svg>
      </button>
    </>
  );
}

/** Mirrored bar waveform of recent loudness, newest on the right. */
function draw(c: HTMLCanvasElement | null, levels: number[]) {
  const g = c?.getContext('2d');
  if (!c || !g) return;
  const W = c.width, H = c.height, n = 64, gap = 6;
  const bw = (W - gap * (n - 1)) / n;
  g.clearRect(0, 0, W, H);
  const grad = g.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0, 'rgba(31,63,153,0.25)');
  grad.addColorStop(1, 'rgba(31,63,153,1)');
  g.fillStyle = grad;
  for (let i = 0; i < n; i++) {
    const v = levels[levels.length - n + i] ?? 0;
    const h = Math.max(6, v * (H - 8));
    const x = i * (bw + gap);
    g.beginPath();
    g.roundRect(x, (H - h) / 2, bw, h, bw / 2);
    g.fill();
  }
}
