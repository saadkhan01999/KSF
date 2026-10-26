/* Scanning with the camera: the phone, tablet or laptop at the counter reads
   the barcode on the pack when there is no hardware scanner — any linear or
   2D code (utils/decode.ts). Each pack is reported once: the same code is
   ignored for a couple of seconds while it is still in front of the lens.

   Where the live camera cannot open (an http:// address, permission refused,
   no camera), "Scan a photo" still works: a phone opens its camera app, and
   the code is read from the picture. */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Camera, CameraOff, ImageUp, RefreshCw, ScanLine, Zap, ZapOff } from 'lucide-react';
import { Button, Modal } from '../../components/ui';
import { decodePhoto, decodeVideo } from '../../utils/decode';

type State = 'starting' | 'scanning' | 'denied' | 'missing' | 'insecure' | 'failed';

const SAME_CODE_PAUSE = 2500;

/** A hidden file input that takes a photo (the camera app on a phone) and reads the code in it. */
export function PhotoScan({ onCode, onNothing, children }: {
  onCode: (code: string) => void; onNothing: () => void;
  children: (open: () => void, reading: boolean) => ReactNode;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const read = async (file: File | undefined) => {
    if (!file) return;
    setReading(true);
    try {
      const code = await decodePhoto(file).catch(() => null);
      if (code) onCode(code); else onNothing();
    } finally {
      setReading(false);
      if (input.current) input.current.value = '';
    }
  };
  return (
    <>
      <input
        ref={input} type="file" accept="image/*" capture="environment" hidden
        onChange={(event) => { void read(event.target.files?.[0]); }}
      />
      {children(() => input.current?.click(), reading)}
    </>
  );
}

export function CameraScanner({ open, onClose, onCode }: { open: boolean; onClose: () => void; onCode: (code: string) => void }) {
  const [photoNote, setPhotoNote] = useState('');
  const video = useRef<HTMLVideoElement>(null);
  const latest = useRef(onCode);
  latest.current = onCode;
  const [state, setState] = useState<State>('starting');
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [cameraId, setCameraId] = useState('');
  const [torch, setTorch] = useState<{ track: MediaStreamTrack; on: boolean } | null>(null);
  const [last, setLast] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) { setState('insecure'); return undefined; }
    setState('starting');
    let stopped = false;
    let stream: MediaStream | null = null;
    let stopDecoding = () => {};
    const seen = new Map<string, number>();
    const report = (code: string) => {
      const now = Date.now();
      if ((seen.get(code) ?? 0) > now - SAME_CODE_PAUSE) return;
      seen.set(code, now);
      setLast(code);
      latest.current(code);
    };

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: cameraId ? { deviceId: { exact: cameraId } } : { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }
        });
        if (stopped || !video.current) { stream.getTracks().forEach((track) => track.stop()); return; }
        video.current.srcObject = stream;
        await video.current.play().catch(() => {});
        setCameras((await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === 'videoinput'));
        const [track] = stream.getVideoTracks();
        const capabilities = (track?.getCapabilities?.() ?? {}) as { torch?: boolean };
        setTorch(capabilities.torch ? { track, on: false } : null);
        stopDecoding = await decodeVideo(video.current, report);
        if (!stopped) setState('scanning');
      } catch (problem) {
        if (stopped) return;
        const name = (problem as Error)?.name;
        setState(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : name === 'NotFoundError' || name === 'OverconstrainedError' ? 'missing' : 'failed');
      }
    })();

    return () => {
      stopped = true;
      stopDecoding();
      stream?.getTracks().forEach((track) => track.stop());
      if (video.current) video.current.srcObject = null;
      setTorch(null);
    };
  }, [open, cameraId]);

  const switchCamera = () => {
    if (cameras.length < 2) return;
    const at = cameras.findIndex((camera) => camera.deviceId === cameraId);
    setCameraId(cameras[(at + 1) % cameras.length].deviceId);
  };

  const toggleTorch = async () => {
    if (!torch) return;
    try {
      await torch.track.applyConstraints({ advanced: [{ torch: !torch.on } as MediaTrackConstraintSet] });
      setTorch({ ...torch, on: !torch.on });
    } catch { setTorch(null); }
  };

  const problem: Record<Exclude<State, 'starting' | 'scanning'>, { title: string; text: string }> = {
    denied: { title: 'The camera was not allowed', text: 'Allow the camera for this site — the camera icon in the address bar — then open the scanner again, or use "Scan a photo".' },
    missing: { title: 'No camera found', text: 'Connect a camera, or use a USB or Bluetooth barcode scanner instead.' },
    insecure: { title: 'The live camera needs a secure address', text: 'Browsers open the camera only on https:// addresses (or on this computer). Use "Scan a photo" below, or open KSF on its https address.' },
    failed: { title: 'The camera could not start', text: 'Another app may be using it. Close it, then try again.' }
  };
  const trouble = state !== 'starting' && state !== 'scanning' ? problem[state] : null;

  return (
    <Modal
      open={open} onClose={onClose} size="md" icon={<Camera />}
      title="Scan with the camera"
      subtitle="Any barcode or QR code: hold it inside the frame. Each pack is added once."
      footer={(
        <>
          <PhotoScan
            onCode={(code) => { setPhotoNote(''); setLast(code); latest.current(code); }}
            onNothing={() => setPhotoNote('No barcode could be read in that photo. Fill the frame with the barcode, in good light, and try again.')}
          >
            {(pick, reading) => <Button variant="outline" icon={<ImageUp size={16} />} loading={reading} onClick={pick}>Scan a photo</Button>}
          </PhotoScan>
          {cameras.length > 1 && <Button variant="outline" icon={<RefreshCw size={16} />} onClick={switchCamera}>Switch camera</Button>}
          {torch && (
            <Button variant="outline" icon={torch.on ? <ZapOff size={16} /> : <Zap size={16} />} onClick={() => { void toggleTorch(); }}>
              {torch.on ? 'Light off' : 'Light on'}
            </Button>
          )}
          <Button variant="primary" onClick={onClose}>Done</Button>
        </>
      )}
    >
      <div className={`cam-view ${state === 'scanning' ? 'is-live' : ''}`}>
        <video ref={video} muted playsInline aria-label="Camera preview" />
        {state === 'scanning' && <div className="cam-frame" aria-hidden="true"><i /></div>}
        {state === 'starting' && <div className="cam-note"><ScanLine size={22} /> Starting the camera…</div>}
        {trouble && (
          <div className="cam-note is-problem" role="alert">
            <CameraOff size={24} />
            <strong>{trouble.title}</strong>
            <span>{trouble.text}</span>
          </div>
        )}
      </div>
      {photoNote && <p className="cam-photo-note" role="alert">{photoNote}</p>}
      <p className="cam-status" aria-live="polite">
        {last ? <>Last read <code>{last.replace(/\u001d/g, ' ')}</code></> : state === 'scanning' ? 'Looking for a barcode…' : ' '}
      </p>
    </Modal>
  );
}
