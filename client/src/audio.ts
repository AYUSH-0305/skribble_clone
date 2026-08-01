// ============================================================================
// Tiny Web Audio engine — procedural background music + sound effects.
// No audio files (CSP-safe, zero network), fully synthesised. All output runs
// through a master gain so a single mute flag silences everything.
// ============================================================================

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let musicBus: GainNode | null = null;
let sfxBus: GainNode | null = null;
let musicTimer: ReturnType<typeof setInterval> | null = null;
let step = 0;

const MUTE_KEY = 'skribbl_muted';
let muted = readMuted();

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

function ensureCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (ctx) return ctx;
  const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  ctx = new Ctor();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 1;
  master.connect(ctx.destination);
  musicBus = ctx.createGain();
  musicBus.gain.value = 0.16; // background music sits low under SFX
  musicBus.connect(master);
  sfxBus = ctx.createGain();
  sfxBus.gain.value = 0.5;
  sfxBus.connect(master);
  return ctx;
}

/** Unlock/resume audio — must be called from a user gesture (click/tap). */
export function initAudio(): void {
  const c = ensureCtx();
  if (c && c.state === 'suspended') void c.resume();
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(next: boolean): void {
  muted = next;
  try {
    localStorage.setItem(MUTE_KEY, next ? '1' : '0');
  } catch {
    /* ignore */
  }
  if (master && ctx) {
    master.gain.setTargetAtTime(next ? 0 : 1, ctx.currentTime, 0.02);
  }
}

/** Play a single enveloped tone. */
function tone(
  freq: number,
  startOffset: number,
  duration: number,
  bus: GainNode,
  type: OscillatorType = 'sine',
  peak = 0.5
): void {
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  osc.connect(g);
  g.connect(bus);
  const t = ctx.currentTime + startOffset;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  osc.start(t);
  osc.stop(t + duration + 0.05);
}

// --- Background music: a gentle music-box loop over I–V–vi–IV -------------
// Pentatonic-friendly melody so it never clashes; one note per step.
const MELODY = [523.25, 392.0, 440.0, 329.63, 392.0, 293.66, 329.63, 261.63];
const BASS = [130.81, 98.0, 110.0, 87.31]; // C3 G2 A2 F2, one per 2 steps

export function startMusic(): void {
  if (!ensureCtx() || musicTimer || !musicBus) return;
  step = 0;
  musicTimer = setInterval(() => {
    if (!ctx || !musicBus) return;
    const n = MELODY[step % MELODY.length];
    tone(n, 0, 0.55, musicBus, 'triangle', 0.5);
    if (step % 2 === 0) tone(BASS[(step / 2) % BASS.length], 0, 1.0, musicBus, 'sine', 0.6);
    step++;
  }, 400);
}

export function stopMusic(): void {
  if (musicTimer) {
    clearInterval(musicTimer);
    musicTimer = null;
  }
}

// --- Sound effects ---------------------------------------------------------
export function sfxCorrect(): void {
  if (!ensureCtx() || !sfxBus) return;
  tone(659.25, 0, 0.14, sfxBus, 'triangle', 0.5); // E5
  tone(987.77, 0.1, 0.2, sfxBus, 'triangle', 0.5); // B5
}

export function sfxTick(): void {
  if (!ensureCtx() || !sfxBus) return;
  tone(1100, 0, 0.05, sfxBus, 'square', 0.25);
}

export function sfxRoundStart(): void {
  if (!ensureCtx() || !sfxBus) return;
  tone(523.25, 0, 0.12, sfxBus, 'triangle', 0.4);
  tone(659.25, 0.1, 0.14, sfxBus, 'triangle', 0.4);
}

export function sfxGameOver(): void {
  if (!ensureCtx() || !sfxBus) return;
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, i * 0.14, 0.32, sfxBus!, 'triangle', 0.5));
}
