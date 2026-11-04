/* A line across the top when a newer KSF is live than the one this tab is
   running. A browser keeps the screens it loaded until the page is reloaded,
   so a till left open across a release keeps the old screens — the old
   payment window, the old receipt — while the server has moved on. Every
   API answer names the server's version (X-KSF-Version); this says so once,
   and reloading is one tap. It never reloads by itself: a sale may be half
   rung up. */

import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from './ui';
import { BRAND } from '../brand';
import { setNewerServerHandler } from '../services/api';

export function UpdateBanner() {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    setNewerServerHandler(setVersion);
    return () => setNewerServerHandler(null);
  }, []);
  if (!version) return null;
  return (
    <div className="plan-banner tone-info update-banner" role="status">
      <RefreshCw size={18} aria-hidden="true" />
      <span className="grow">
        <strong>KSF {version} is ready.</strong> This page is still running {BRAND.version}. Finish the sale you are on, then
        reload to get the new screens.
      </span>
      <Button size="sm" variant="primary" icon={<RefreshCw size={15} />} onClick={() => window.location.reload()}>Reload now</Button>
    </div>
  );
}
