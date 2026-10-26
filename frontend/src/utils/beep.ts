/* The till's sounds: a bright two-note chime when a scan is added, a low
   double tone when it is not — so the cashier knows without looking at the
   screen. Each device remembers whether sound is on.

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
const TONES: Record<'ok' | 'error', { wave: OscillatorType; notes: Array<[number, number, number, number]> }> = {
  /* E6 then A6: short, bright and friendly, heard over a busy counter. */
  ok: { wave: 'sine', notes: [[1318.5, 0, 0.07, 0.2], [1760, 0.075, 0.11, 0.22]] },
  error: { wave: 'triangle', notes: [[392, 0, 0.13, 0.22], [294, 0.16, 0.18, 0.22]] }
};

export function beep(kind: 'ok' | 'error'): void {
  if (!scannerSound()) return;
  const sound = context();
  if (!sound) return;
  try {
    const { wave, notes } = TONES[kind];
    for (const [frequency, start, length, loudness] of notes) {
      const begin = sound.currentTime + 0.01 + start;
      const tone = sound.createOscillator();
      const volume = sound.createGain();
      tone.type = wave;
      tone.frequency.value = frequency;
      volume.gain.setValueAtTime(0.0001, begin);
      volume.gain.exponentialRampToValueAtTime(loudness, begin + 0.008);
      volume.gain.exponentialRampToValueAtTime(0.0001, begin + length);
      tone.connect(volume).connect(sound.destination);
      tone.start(begin);
      tone.stop(begin + length + 0.03);
    }
  } catch { /* no sound on this device; the screen still says what happened */ }
}
