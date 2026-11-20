/* ==========================================================================
   How much the pages move
   --------------------------------------------------------------------------
   public/theme.js decides before the first paint and writes it on <html> as
   data-motion: "full", "calm" (the device asks for less motion) or "off"
   (switched off on the website). The stylesheets read the attribute; the
   scripts read it here.
   ========================================================================== */

export type MotionLevel = 'full' | 'calm' | 'off';
export type MotionChoice = 'on' | 'off' | 'auto';

const STORE = 'ksf-motion';

/** The level in force now. Anywhere without a document (tests) is still. */
export function motionLevel(): MotionLevel {
  if (typeof document === 'undefined') return 'off';
  const level = document.documentElement.getAttribute('data-motion');
  if (level === 'calm' || level === 'off') return level;
  if (level === 'full') return 'full';
  /* theme.js did not run (an old cached page): the device decides. */
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'calm' : 'full';
}

/** The visitor's own choice, if they made one with the switch. */
export function motionChoice(): MotionChoice {
  try {
    const stored = localStorage.getItem(STORE);
    return stored === 'on' || stored === 'off' ? stored : 'auto';
  } catch {
    return 'auto';
  }
}

/** Switch the website's animations on or off (or back to the device's say), at once and for next time. */
export function setMotionChoice(choice: MotionChoice): MotionLevel {
  try {
    if (choice === 'auto') localStorage.removeItem(STORE);
    else localStorage.setItem(STORE, choice);
  } catch {
    /* Storage refused: the choice still holds for this page. */
  }
  const calm = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const level: MotionLevel = choice === 'off' ? 'off' : choice === 'on' ? 'full' : calm ? 'calm' : 'full';
  document.documentElement.setAttribute('data-motion', level);
  window.dispatchEvent(new CustomEvent('ksf-motion', { detail: level }));
  return level;
}
