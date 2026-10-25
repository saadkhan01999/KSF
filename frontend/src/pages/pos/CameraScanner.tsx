/* Scanning with the camera: the phone, tablet or laptop at the counter reads
   the barcode on the pack when there is no hardware scanner.

   The browser's own BarcodeDetector is used where it exists (Chrome on
   Android and macOS); everywhere else the ZXing decoder is loaded, only when
   the camera is first opened, so the till itself stays light. Each pack is
   reported once: the same code is ignored for a couple of seconds while it
   is still in front of the lens. */

import { useEffect, useRef, useState } from 'react';
import { Camera, CameraOff, RefreshCw, ScanLine, Zap, ZapOff } from 'lucide-react';
import { Button, Modal } from '../../components/ui';

type State = 'starting' | 'scanning' | 'denied' | 'missing' | 'insecure' | 'failed';

/* Formats on medicine packs and shop labels, in each decoder's own names. */
const NATIVE_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'qr_code', 'data_matrix'];
const SAME_CODE_PAUSE = 2500;

interface NativeDetector { detect(source: HTMLVideoElement): Promise<Array<{ rawValue: string }>> }
interface NativeDetectorClass {
  new (options: { formats: string[] }): NativeDetector;
  getSupportedFormats?: () => Promise<string[]>;
}

/** Starts reading codes off the video; returns how to stop. */
async function startDecoding(video: HTMLVideoElement, report: (code: string) => void): Promise<() => void> {
  const Native = (window as unknown as { BarcodeDetector?: NativeDetectorClass }).BarcodeDetector;
  const supported = Native ? await Native.getSupportedFormats?.().catch(() => []) ?? [] : [];
  const formats = NATIVE_FORMATS.filter((format) => supported.includes(format));
  if (Native && formats.includes('ean_13')) {
    const detector = new Native({ formats });
    let running = true;
    const look = async () => {
      if (!running) return;
      try {
        if (video.readyState >= 2) {
          const [found] = await detector.detect(video);
          if (found?.rawValue) report(found.rawValue);
        }
      } catch { /* a frame that could not be read */ }
      if (running) window.setTimeout(() => { void look(); }, 120);
    };
    void look();
    return () => { running = false; };
  }

  const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([import('@zxing/browser'), import('@zxing/library')]);
  const hints = new Map<unknown, unknown>([
    [DecodeHintType.POSSIBLE_FORMATS, [
      BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E, BarcodeFormat.CODE_128,
      BarcodeFormat.CODE_39, BarcodeFormat.ITF, BarcodeFormat.QR_CODE, BarcodeFormat.DATA_MATRIX
    ]],
    [DecodeHintType.TRY_HARDER, true]
  ]);
  const reader = new BrowserMultiFormatReader(hints as Map<never, unknown>, { delayBetweenScanAttempts: 120, delayBetweenScanSuccess: 400 });
  const controls = await reader.decodeFromVideoElement(video, (result) => { if (result) report(result.getText()); });
  return () => controls.stop();
}

export function CameraScanner({ open, onClose, onCode }: { open: boolean; onClose: () => void; onCode: (code: string) => void }) {
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
        stopDecoding = await startDecoding(video.current, report);
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
    denied: { title: 'The camera was not allowed', text: 'Allow the camera for this site — the camera icon in the address bar — then open the scanner again.' },
    missing: { title: 'No camera found', text: 'Connect a camera, or use a USB or Bluetooth barcode scanner instead.' },
    insecure: { title: 'The camera needs a secure address', text: 'Browsers open the camera only on https:// addresses (or on this computer). Open KSF on its https address.' },
    failed: { title: 'The camera could not start', text: 'Another app may be using it. Close it, then try again.' }
  };
  const trouble = state !== 'starting' && state !== 'scanning' ? problem[state] : null;

  return (
    <Modal
      open={open} onClose={onClose} size="md" icon={<Camera />}
      title="Scan with the camera"
      subtitle="Hold the barcode inside the frame. Each pack is added once."
      footer={(
        <>
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
      <p className="cam-status" aria-live="polite">
        {last ? <>Last read <code>{last.replace(/\u001d/g, ' ')}</code></> : state === 'scanning' ? 'Looking for a barcode…' : ' '}
      </p>
    </Modal>
  );
}
