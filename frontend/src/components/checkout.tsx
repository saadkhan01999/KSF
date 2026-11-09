/* ==========================================================================
   Paying for a plan: choose how to pay, then go to the provider's own page
   or follow the transfer instructions
   --------------------------------------------------------------------------
   Used by Subscription plans (the Pro and Diamond Annual review pages) and
   by Settings › Billing. Nothing here makes a plan active: the server starts
   it when the provider confirms the payment to it, never because a browser
   came back from a checkout page.
   ========================================================================== */

import { useEffect, useState } from 'react';
import { Lock } from 'lucide-react';
import { useAction } from '../hooks/useApi';
import { api } from '../services/api';
import { Badge, Button, Modal } from './ui';
import { CopyField, DetailRow, StatusNote } from './account-ui';
import { rupees } from '../utils/format';
import type { BillingOverview, CheckoutReply } from '../types';

/** Send the browser to the provider's own page: a link, or a signed form it posts. */
export function goToProvider(redirect: NonNullable<CheckoutReply['redirect']>): void {
  if (redirect.method === 'GET') { window.location.assign(redirect.url); return; }
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = redirect.url;
  for (const [name, value] of Object.entries(redirect.fields)) {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
}

const INSTRUCTION_LABELS = { bank: 'Bank', accountTitle: 'Account title', accountNumber: 'Account number', iban: 'IBAN', branch: 'Branch', raastId: 'Raast ID' } as const;

/**
 * The two windows of a payment: how to pay for `planKey` (open while it is
 * set), then — for a bank transfer — the reference and the account to pay
 * into. A card or a wallet leaves for the provider's page instead.
 */
export function CheckoutDialogs({ data, planKey, onClose, onDone }: {
  data: BillingOverview;
  planKey: string | null;
  onClose: () => void;
  /** Called when the person closes the transfer instructions: reload the plan. */
  onDone: () => void;
}) {
  const { busy, run } = useAction();
  const [provider, setProvider] = useState(data.defaultProvider);
  const [checkout, setCheckout] = useState<CheckoutReply | null>(null);
  const plan = data.plans.find((row) => row.key === planKey) ?? null;

  useEffect(() => { if (planKey) setProvider(data.defaultProvider); }, [planKey, data.defaultProvider]);

  const start = async () => {
    if (!plan) return;
    const reply = await run(() => api.post<CheckoutReply>('/billing/checkout', { planKey: plan.key, provider }));
    if (!reply) return;
    if (reply.redirect) goToProvider(reply.redirect);
    else setCheckout(reply);
  };

  const price = plan ? plan.yourPricePaisa ?? plan.pricePaisa : 0;
  return (
    <>
      <Modal
        open={!!plan && !checkout}
        onClose={onClose}
        icon={<Lock />}
        title={plan ? `Pay for ${plan.name}` : 'Pay'}
        subtitle={plan ? `${rupees(price)} per ${plan.period}${plan.referralApplied ? ' (referral price)' : ''}${plan.autoRenew ? ', renewing automatically until you stop it' : ''}${plan.maxCycles > 0 ? `, for up to ${plan.cyclesLeft ?? plan.maxCycles} month(s)` : ''}` : ''}
        footer={(
          <>
            <Button variant="ghost" onClick={onClose}>Not now</Button>
            <Button variant="primary" icon={<Lock size={15} />} loading={busy} disabled={!provider || !plan || data.providers.length === 0} onClick={() => { void start(); }}>
              Continue to payment
            </Button>
          </>
        )}
      >
        {data.providers.length === 0 ? (
          <StatusNote tone="warn" title="Online payment is not set up yet">
            This installation cannot take payments online yet. The KSF team can record a payment for you — contact support
            with your subscription reference.
          </StatusNote>
        ) : (
          <div className="pay-options" role="radiogroup" aria-label="How to pay">
            {data.providers.map((option) => (
              <label key={option.key} className={`pay-option ${provider === option.key ? 'is-on' : ''}`}>
                <input type="radio" name="provider" value={option.key} checked={provider === option.key} onChange={() => setProvider(option.key)} />
                <span>
                  <strong>{option.label}</strong>
                  {option.mode === 'test' || option.mode === 'sandbox' ? <Badge tone="warn" dot={false}>Test mode</Badge> : null}
                  <small>{option.note}</small>
                </span>
              </label>
            ))}
          </div>
        )}
        <p className="card-note">
          You pay on the provider&apos;s own secure page; card details never reach KSF. The plan turns active the moment the
          provider confirms the payment to our server, and this screen updates by itself.
        </p>
      </Modal>

      <Modal
        open={!!checkout}
        onClose={() => { setCheckout(null); onClose(); onDone(); }}
        title="Complete the payment"
        subtitle={checkout ? `${checkout.plan.name} — ${rupees(checkout.amountPaisa)}` : ''}
        footer={<Button variant="primary" onClick={() => { setCheckout(null); onClose(); onDone(); }}>Done</Button>}
      >
        {checkout && (
          <>
            <CopyField label="Payment reference" value={checkout.reference} hint="Put this on the transfer. Without it the payment cannot be matched to your pharmacy." />
            {checkout.instructions && (
              <dl className="detail-list">
                {(Object.keys(INSTRUCTION_LABELS) as (keyof typeof INSTRUCTION_LABELS)[]).map((key) => (
                  checkout.instructions?.[key]
                    ? <DetailRow key={key} label={INSTRUCTION_LABELS[key]}>{String(checkout.instructions[key])}</DetailRow>
                    : null
                ))}
              </dl>
            )}
            <StatusNote tone="info">{checkout.note}</StatusNote>
          </>
        )}
      </Modal>
    </>
  );
}
