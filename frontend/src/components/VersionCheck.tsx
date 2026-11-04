/* Is the new release live everywhere? On Vercel the website and the API are
   built and deployed together, but a browser can still hold an older copy of
   the website, and a server (Hostinger, Docker) can lag behind a release.
   This asks the server which version it runs and says plainly whether the
   two agree — and, when they do not, what to do. */

import { useEffect, useState } from 'react';
import { CheckCircle2, CircleAlert, Loader2 } from 'lucide-react';
import { BRAND } from '../brand';
import { api } from '../services/api';
import { compareVersions } from '../utils/version';

type Check = { state: 'checking' } | { state: 'unreachable' } | { state: 'done'; server: string };

export function useServerVersion(): Check {
  const [check, setCheck] = useState<Check>({ state: 'checking' });
  useEffect(() => {
    let live = true;
    api.get<{ version?: string }>('/health')
      .then((reply) => { if (live) setCheck(reply.version ? { state: 'done', server: reply.version } : { state: 'unreachable' }); })
      .catch(() => { if (live) setCheck({ state: 'unreachable' }); });
    return () => { live = false; };
  }, []);
  return check;
}

export function VersionCheck() {
  const check = useServerVersion();
  const website = BRAND.version;

  if (check.state === 'checking') {
    return <div className="version-check"><Loader2 size={15} className="spin" aria-hidden="true" /> Checking the server&apos;s version…</div>;
  }
  if (check.state === 'unreachable') {
    return (
      <div className="version-check is-warn" role="status">
        <CircleAlert size={16} aria-hidden="true" /> Website {website} · the server did not say which version it runs.
      </div>
    );
  }
  const order = compareVersions(check.server, website);
  const same = order === 0;
  return (
    <div className={`version-check ${same ? 'is-ok' : 'is-warn'}`} role="status">
      {same ? <CheckCircle2 size={16} aria-hidden="true" /> : <CircleAlert size={16} aria-hidden="true" />}
      <span>
        Website <b>{website}</b> · Server <b>{check.server}</b>
        {same
          ? ' — up to date'
          : order < 0
            ? ' — the server has not updated yet: redeploy it from main'
            : ' — this page is older than the server: reload it'}
      </span>
    </div>
  );
}
