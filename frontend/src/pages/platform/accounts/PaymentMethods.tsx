/* Which ways to pay KSF are switched on, what each one still needs, and the
   addresses to register with the provider — so "why can't pharmacies pay by
   card?" has an answer on the screen rather than in the server's settings. */

import { useState } from 'react';
import { CheckCircle2, CircleDashed, Copy, CreditCard, Landmark, Smartphone, Wallet } from 'lucide-react';
import { useApp } from '../../../context/AppContext';
import { useApiData } from '../../../hooks/useApi';
import { Badge, CardSkeleton } from '../../../components/ui';
import { StatusNote } from '../../../components/account-ui';
import type { PaymentProviderSetup } from '../../../types/accounting';

const ICONS: Record<string, React.ReactNode> = {
  stripe: <CreditCard size={20} />, 'bank-transfer': <Landmark size={20} />, jazzcash: <Smartphone size={20} />,
  easypaisa: <Smartphone size={20} />, gateway: <Wallet size={20} />
};

function CopyLine({ label, value }: { label: string; value: string }) {
  const { ok } = useApp();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      ok('Copied', `${label} copied.`);
      window.setTimeout(() => setCopied(false), 1500);
    } catch { /* the address stays selectable */ }
  };
  return (
    <div className="pm-url">
      <span className="pm-url-label">{label}</span>
      <code>{value}</code>
      <button type="button" className="icon-btn" onClick={() => { void copy(); }} aria-label={`Copy ${label}`}>
        {copied ? <CheckCircle2 size={16} /> : <Copy size={16} />}
      </button>
    </div>
  );
}

export function PaymentMethods() {
  const { data } = useApiData<{ data: PaymentProviderSetup[]; default: string; university: boolean }>('/platform/payments/providers');
  if (!data) return <CardSkeleton count={3} />;
  const on = data.data.filter((provider) => provider.configured);

  return (
    <>
      {data.university
        ? <StatusNote tone="info" title="The university edition takes no payments">Every way to pay is switched off in this copy, whatever its settings say.</StatusNote>
        : on.length === 0
          ? (
            <StatusNote tone="warn" title="Pharmacies cannot pay online yet">
              No way to pay is set up. Add the settings named under a provider below to the server (on Vercel: the project › Settings › Environment Variables), then redeploy it.
              Until then, record payments by hand from a pharmacy&apos;s page.
            </StatusNote>
          )
          : (
            <StatusNote tone="ok" title={`${on.length} way${on.length === 1 ? '' : 's'} to pay ${on.length === 1 ? 'is' : 'are'} switched on`}>
              Pharmacies see {on.map((provider) => provider.label).join(', ')} on their Billing page{data.default ? `, with ${on.find((provider) => provider.key === data.default)?.label ?? data.default} offered first` : ''}.
            </StatusNote>
          )}

      <div className="pm-grid mt-5">
        {data.data.map((provider) => (
          <article key={provider.key} className={`pm-card ${provider.configured ? 'is-on' : ''}`}>
            <header className="pm-head">
              <span className="pm-icon" aria-hidden="true">{ICONS[provider.key] ?? <Wallet size={20} />}</span>
              <div className="grow">
                <h3>{provider.label}</h3>
                <div className="row-tight wrap">
                  {provider.configured
                    ? <Badge tone="ok">Switched on</Badge>
                    : <Badge tone="neutral" dot={false} icon={<CircleDashed size={12} />}>Not set up</Badge>}
                  {provider.configured && provider.mode !== 'manual' && (
                    <Badge tone={provider.mode === 'live' ? 'ok' : 'warn'} dot={false}>{provider.mode === 'live' ? 'Live' : 'Test mode'}</Badge>
                  )}
                  {provider.key === data.default && <Badge tone="info" dot={false}>Offered first</Badge>}
                </div>
              </div>
            </header>
            <p className="pm-note">{provider.note}</p>
            {!provider.configured && provider.missing.length > 0 && (
              <div className="pm-missing">
                <span className="t-xs t-dim">Settings it needs on the API server</span>
                <div className="row-tight wrap">{provider.missing.map((name) => <code key={name}>{name}</code>)}</div>
              </div>
            )}
            {provider.webhookUrl && <CopyLine label="Webhook address" value={provider.webhookUrl} />}
            {provider.returnUrl && <CopyLine label="Return address" value={provider.returnUrl} />}
          </article>
        ))}
      </div>
      <p className="card-note mt-4">
        Setting values are never shown here, only their names. <code>docs/PAYMENTS.md</code> explains each provider, step by step.
      </p>
    </>
  );
}
