/* What "Scanner ready" opens: that the till is listening, what the last scan
   was (the quickest way to test a scanner just plugged in), the camera, the
   beep, and what to check when a scanner does nothing. */

import { useState } from 'react';
import { Camera, CircleAlert, CircleCheck, ScanLine, Volume2 } from 'lucide-react';
import { Button, Switch } from '../../components/ui';
import { beep, scannerSound, setScannerSound } from '../../utils/beep';

export interface LastScan {
  code: string;
  at: string;
  outcome: 'added' | 'unknown' | 'several' | 'refused' | 'busy';
  name?: string;
}

const OUTCOME: Record<LastScan['outcome'], string> = {
  added: 'Added to the sale',
  unknown: 'Not in the catalogue yet',
  several: 'More than one medicine has this barcode',
  refused: 'Found, but could not be added',
  busy: 'Ignored while the payment window was open'
};

export function ScannerPanel({ last, onCamera }: { last: LastScan | null; onCamera: () => void }) {
  const [sound, setSound] = useState(scannerSound());
  const toggleSound = (on: boolean) => { setScannerSound(on); setSound(on); if (on) beep('ok'); };

  return (
    <div className="scanner-panel">
      <header className="panel-head"><h3>Barcode scanner</h3></header>
      <div className="scanner-body">
        <div className="scanner-ready">
          <span className="scanner-pulse" aria-hidden="true" />
          <div>
            <strong>Ready for a USB or Bluetooth scanner</strong>
            <span>Scan any pack. It goes straight into the sale, wherever the cursor is.</span>
          </div>
        </div>

        <div className={`scanner-last ${last ? `is-${last.outcome === 'added' ? 'ok' : 'warn'}` : ''}`}>
          {last ? (
            <>
              {last.outcome === 'added' ? <CircleCheck size={18} /> : <CircleAlert size={18} />}
              <div>
                <code>{last.code.replace(/\u001d/g, ' ')}</code>
                <span>{last.name ? `${last.name} — ` : ''}{OUTCOME[last.outcome]}</span>
              </div>
            </>
          ) : (
            <>
              <ScanLine size={18} />
              <div><span>Nothing scanned yet. Scan any pack to test your scanner.</span></div>
            </>
          )}
        </div>

        <Button variant="primary" block icon={<Camera size={17} />} onClick={onCamera}>Scan with the camera</Button>

        <div className="scanner-sound">
          <Volume2 size={16} aria-hidden="true" />
          <Switch checked={sound} onChange={toggleSound} label="Beep on each scan" />
        </div>

        <details className="scanner-help">
          <summary>Scanner not doing anything?</summary>
          <ul>
            <li>Set it to <b>keyboard (HID) mode</b> and to send <b>Enter</b> after each code — most scanners do both out of the box.</li>
            <li>Bluetooth: pair it with this computer or tablet first, like a keyboard.</li>
            <li>Ordinary barcodes (EAN, UPC, Code 128) and the square <b>DataMatrix</b> codes on medicine packs both work. The square ones need a 2D scanner.</li>
            <li>Scanned and nothing happened? The last code read appears above — if it is there, the scanner works and the code is simply not on a medicine yet.</li>
          </ul>
        </details>
      </div>
    </div>
  );
}
