/* The till's sounds: one short high beep when a scan is added, a low double
   tone when it is not — so the cashier knows without looking at the screen.
   Each device remembers whether sound is on. */

const SOUND_KEY = 'ksf.scanner.sound';
let audio: AudioContext | null = null;

export function scannerSound(): boolean {
  try { return localStorage.getItem(SOUND_KEY) !== 'off'; } catch { return true; }
}

export function setScannerSound(on: boolean): void {
  try { localStorage.setItem(SOUND_KEY, on ? 'on' : 'off'); } catch { /* this tab only */ }
}

export function beep(kind: 'ok' | 'error'): void {
  if (!scannerSound()) return;
  try {
    const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Context) return;
    audio ??= new Context();
    if (audio.state === 'suspended') void audio.resume();
    /* [frequency in Hz, start, length] in seconds */
    const tones: Array<[number, number, number]> = kind === 'ok' ? [[1480, 0, 0.08]] : [[330, 0, 0.12], [247, 0.15, 0.16]];
    for (const [frequency, start, length] of tones) {
      const begin = audio.currentTime + start;
      const tone = audio.createOscillator();
      const volume = audio.createGain();
      tone.type = kind === 'ok' ? 'sine' : 'square';
      tone.frequency.value = frequency;
      volume.gain.setValueAtTime(0.0001, begin);
      volume.gain.exponentialRampToValueAtTime(kind === 'ok' ? 0.18 : 0.08, begin + 0.01);
      volume.gain.exponentialRampToValueAtTime(0.0001, begin + length);
      tone.connect(volume).connect(audio.destination);
      tone.start(begin);
      tone.stop(begin + length + 0.02);
    }
  } catch { /* no sound on this device; the screen still says what happened */ }
}
