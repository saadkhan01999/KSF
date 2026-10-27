/* The till's sounds: the short, bright "beep" of a checkout scanner when a
   code is read and the medicine picked, and a low double buzz when it is not
   — so the cashier knows without looking at the screen. On a phone each also
   buzzes the handset. Each device remembers whether sound is on.

   Browsers keep sound off until the person has pressed a key or touched the
   page, so the sound is woken at the first touch, click or key press (a
   scanner's first key counts) and is ready by the time a lookup answers. */

const SOUND_KEY = 'ksf.scanner.sound';
let audio: AudioContext | null = null;

export function scannerSound(): boolean {
  try { return localStorage.getItem(SOUND_KEY) !== 'off'; } catch { return true; }
}

export function setScannerSound(on: boolean): void {
  try { localStorage.setItem(SOUND_KEY, on ? 'on' : 'off'); } catch { /* this tab only */ }
}

function context(): AudioContext | null {
  try {
    const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Context) return null;
    audio ??= new Context();
    if (audio.state === 'suspended') void audio.resume().catch(() => undefined);
    return audio;
  } catch { return null; }
}

/** Call from inside a key press or click: lets the next beep play. */
export function wakeSound(): void {
  if (scannerSound()) context();
}

if (typeof window !== 'undefined') {
  const once = () => {
    wakeSound();
    for (const name of ['pointerdown', 'keydown', 'touchend'] as const) window.removeEventListener(name, once, true);
  };
  for (const name of ['pointerdown', 'keydown', 'touchend'] as const) window.addEventListener(name, once, { capture: true, passive: true });
}

/* [frequency in Hz, start, length, loudness] — start and length in seconds. */
const TONES: Record<'ok' | 'error', { wave: OscillatorType; notes: Array<[number, number, number, number]>; buzz: number | number[] }> = {
  /* The checkout beep: one square-wave tone near 2.7 kHz, a tenth of a second,
     softened a little so it is crisp rather than shrill. */
  ok: { wave: 'square', notes: [[2730, 0, 0.11, 0.16]], buzz: 45 },
  error: { wave: 'square', notes: [[440, 0, 0.12, 0.13], [330, 0.17, 0.16, 0.13]], buzz: [70, 50, 70] }
};

export function beep(kind: 'ok' | 'error'): void {
  if (!scannerSound()) return;
  try { navigator.vibrate?.(TONES[kind].buzz); } catch { /* no vibration motor */ }
  const sound = context();
  if (!sound) return;
  try {
    const { wave, notes } = TONES[kind];
    /* Take the edge off the square wave's highest harmonics. */
    const soften = sound.createBiquadFilter();
    soften.type = 'lowpass';
    soften.frequency.value = kind === 'ok' ? 6500 : 2400;
    soften.connect(sound.destination);
    for (const [frequency, start, length, loudness] of notes) {
      const begin = sound.currentTime + 0.005 + start;
      const tone = sound.createOscillator();
      const volume = sound.createGain();
      tone.type = wave;
      tone.frequency.value = frequency;
      /* A flat top and a fast edge: the scanner's "beep", not a chime. */
      volume.gain.setValueAtTime(0.0001, begin);
      volume.gain.linearRampToValueAtTime(loudness, begin + 0.004);
      volume.gain.setValueAtTime(loudness, begin + length - 0.012);
      volume.gain.linearRampToValueAtTime(0.0001, begin + length);
      tone.connect(volume).connect(soften);
      tone.start(begin);
      tone.stop(begin + length + 0.02);
    }
  } catch { /* no sound on this device; the screen still says what happened */ }
}
