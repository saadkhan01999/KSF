/* Whether a CSS media query matches now, kept current as the window changes
   (a phone turned on its side, a desktop window dragged narrower). For the
   few things CSS cannot change on its own — a placeholder's wording. */

import { useEffect, useState } from 'react';

const query = (media: string): MediaQueryList | null =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(media) : null;

export function useMediaQuery(media: string): boolean {
  const [matches, setMatches] = useState(() => query(media)?.matches ?? false);

  useEffect(() => {
    const list = query(media);
    if (!list) return undefined;
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, [media]);

  return matches;
}
