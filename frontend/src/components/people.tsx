/* A person's face: their photo when there is one, their initials when not.
   And the picker that turns a photo from a phone or a camera into one. */

import { useRef, useState } from 'react';
import { Camera, Trash2 } from 'lucide-react';
import { initials } from '../utils/format';
import { Button } from './ui';

export function PersonAvatar({
  name, url, size, tone, className = ''
}: { name: string | null | undefined; url?: string | null; size?: 'xs' | 'sm' | 'lg' | 'xl'; tone?: 'gold' | 'neutral'; className?: string }) {
  const [broken, setBroken] = useState(false);
  const photo = url && !broken;
  return (
    <span className={`avatar ${size ?? ''} ${tone ?? ''} ${photo ? 'has-photo' : ''} ${className}`} aria-hidden="true">
      {photo ? <img src={url} alt="" loading="lazy" decoding="async" onError={() => setBroken(true)} /> : initials(name)}
    </span>
  );
}

/* What is sent is a square crop, small enough to store and quick to load
   everywhere the face appears. The server checks it again either way. */
const SIDE = 512;
const ACCEPT = ['image/jpeg', 'image/png', 'image/webp'];

/** Read an image file and return a centred square JPEG as a data: URL. */
export async function squarePhoto(file: File): Promise<string> {
  if (!ACCEPT.includes(file.type)) throw new Error('Choose a JPEG, PNG or WebP photo.');
  if (file.size > 15 * 1024 * 1024) throw new Error('That photo is very large. Choose one under 15 MB.');
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('That file could not be read as a photo.'));
      element.src = url;
    });
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = Math.min(SIDE, side);
    canvas.height = canvas.width;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser cannot prepare the photo.');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.86);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * A photo with "Choose photo" and "Remove". `value` is what shows now — an
 * address, or a freshly chosen data: URL — and `onChange` gets the new data:
 * URL, or null for "no photo".
 */
export function PhotoPicker({
  name, value, onChange, onError, busy
}: { name: string; value: string | null; onChange: (dataUrl: string | null) => void; onError: (message: string) => void; busy?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setReading(true);
    try {
      onChange(await squarePhoto(file));
    } catch (problem) {
      onError(problem instanceof Error ? problem.message : 'That photo could not be used.');
    } finally {
      setReading(false);
      if (input.current) input.current.value = '';
    }
  };

  return (
    <div className="photo-picker">
      <PersonAvatar name={name || '?'} url={value} size="xl" />
      <div className="photo-picker-actions">
        <input
          ref={input} type="file" accept={ACCEPT.join(',')} className="sr-only" tabIndex={-1}
          onChange={(event) => { void pick(event.target.files?.[0]); }}
        />
        <Button variant="secondary" size="sm" icon={<Camera size={15} />} loading={reading || busy} onClick={() => input.current?.click()}>
          {value ? 'Change photo' : 'Choose photo'}
        </Button>
        {value && (
          <Button variant="ghost" size="sm" icon={<Trash2 size={15} />} disabled={reading || busy} onClick={() => onChange(null)}>Remove</Button>
        )}
        <span className="hint">JPEG, PNG or WebP. It is cropped to a square.</span>
      </div>
    </div>
  );
}
