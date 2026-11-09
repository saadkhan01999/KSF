/* ==========================================================================
   Pieces shared by the Subscription wallet and its two review pages
   ========================================================================== */

import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Mail, MessageCircle, Phone, Send } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useAction } from '../../hooks/useApi';
import { api } from '../../services/api';
import { Button, Modal, TextArea } from '../../components/ui';
import type { PlanOffer, SubscriptionState } from '../../types';

/** "PKR 1,400": the wallet speaks in the currency's code, as the plans are priced. */
export const pkr = (paisa: number | null | undefined): string =>
  `PKR ${Math.round((paisa ?? 0) / 100).toLocaleString('en-PK')}`;

/** "Workspace / Subscription plans" (the platform console uses "›"). */
export function Crumbs({ trail, separator = '/' }: { trail: { label: string; to?: string }[]; separator?: string }) {
  return (
    <nav className="crumbs" aria-label="You are here">
      {trail.map((item, index) => (
        <span key={item.label}>
          {index > 0 && <span className="crumbs-sep" aria-hidden="true">{separator}</span>}
          {item.to ? <Link to={item.to}>{item.label}</Link> : <span aria-current={index === trail.length - 1 ? 'page' : undefined}>{item.label}</span>}
        </span>
      ))}
    </nav>
  );
}

/** The paid plans by what they are: the monthly one (Pro) and the yearly one (Diamond Annual). */
export function paidPlans(plans: PlanOffer[]) {
  const live = plans.filter((plan) => !plan.isTrial);
  return {
    trial: plans.find((plan) => plan.isTrial) ?? null,
    monthly: live.find((plan) => plan.period === 'month') ?? null,
    yearly: live.find((plan) => plan.period === 'year') ?? null
  };
}

/** "Pro monthly" — a monthly plan named the way the wallet and the platform name it. */
export const monthlyName = (name: string): string => (/month/i.test(name) ? name : `${name} monthly`);

/**
 * What the pharmacy is on, in the wallet's words: Demo trial, Standard
 * Referral (a trial that came through, or was lengthened by, a referral),
 * Pro monthly or Diamond Annual.
 */
export function currentPlanLabel(subscription: SubscriptionState): string {
  if (subscription.locked) return subscription.isTrial || subscription.plan === 'none' ? 'Trial ended' : `${subscription.planName} (ended)`;
  if (subscription.isTrial) {
    const trial = subscription.trial;
    const referral = !!trial && (trial.source === 'referral' || trial.source === 'referral-reward' || (trial.bonusDays ?? 0) > 0);
    return referral ? 'Standard Referral' : /trial/i.test(subscription.planName) ? subscription.planName : `${subscription.planName} trial`;
  }
  return subscription.cycles?.period === 'month' || subscription.plan === 'monthly' ? monthlyName(subscription.planName) : subscription.planName;
}

/** wa.me wants the number as digits with the country code: +92 371 3999656 → 923713999656. */
export const whatsappNumber = (phone: string | null | undefined): string => {
  const digits = String(phone ?? '').replace(/\D/g, '');
  return digits.startsWith('0') ? `92${digits.slice(1)}` : digits;
};

export interface SalesContact { phone: string | null; whatsapp: string | null; email: string | null }

/**
 * Contact KSF about the annual plan or a price of your own: call, WhatsApp,
 * e-mail, or send a request that lands on the KSF support desk.
 */
export function ContactKsfDialog({ open, onClose, topic, contact }: {
  open: boolean;
  onClose: () => void;
  topic: { title: string; subject: string; message: string };
  contact: SalesContact | null | undefined;
}) {
  const { ok, can } = useApp();
  const { busy, run } = useAction();
  const [note, setNote] = useState(topic.message);
  const [sent, setSent] = useState<string | null>(null);
  const phone = contact?.phone ?? null;
  const whatsapp = whatsappNumber(contact?.whatsapp ?? phone);

  const send = () => run(
    () => api.post<{ message: string }>('/support/tickets', { subject: topic.subject, category: 'billing', priority: 'normal', body: note.trim() || topic.message }),
    (reply) => { setSent(reply.message); ok(reply.message); }
  );

  const close = () => { setSent(null); setNote(topic.message); onClose(); };
  const options: { key: string; icon: ReactNode; title: string; detail: string; href: string }[] = [
    ...(phone ? [{ key: 'call', icon: <Phone size={18} />, title: `Call ${phone}`, detail: 'Speak with KSF now', href: `tel:${phone.replace(/[^\d+]/g, '')}` }] : []),
    ...(whatsapp ? [{
      key: 'whatsapp', icon: <MessageCircle size={18} />, title: 'WhatsApp KSF', detail: 'Send a message from your phone',
      href: `https://wa.me/${whatsapp}?text=${encodeURIComponent(topic.message)}`
    }] : []),
    ...(contact?.email ? [{
      key: 'email', icon: <Mail size={18} />, title: `E-mail ${contact.email}`, detail: 'We reply on working days',
      href: `mailto:${contact.email}?subject=${encodeURIComponent(topic.subject)}&body=${encodeURIComponent(topic.message)}`
    }] : [])
  ];

  return (
    <Modal open={open} onClose={close} icon={<Phone />} title="Contact KSF" subtitle={topic.title}
      footer={<Button variant="outline" onClick={close}>Close</Button>}>
      <div className="contact-options">
        {options.map((option) => (
          <a key={option.key} className="contact-option" href={option.href} target={option.key === 'whatsapp' ? '_blank' : undefined} rel="noreferrer">
            <span className="contact-option-icon" aria-hidden="true">{option.icon}</span>
            <span><strong>{option.title}</strong><small>{option.detail}</small></span>
          </a>
        ))}
      </div>
      {can('support.raise') && (
        <div className="contact-message">
          {sent
            ? <p className="contact-sent" role="status">{sent} The KSF team will reply under Help &amp; Support.</p>
            : (
              <>
                <TextArea label="Or send KSF a message" rows={3} maxLength={2000} value={note} onChange={(event) => setNote(event.target.value)} />
                <Button variant="primary" icon={<Send size={15} />} loading={busy} disabled={!note.trim()} onClick={() => { void send(); }}>
                  Send to KSF
                </Button>
              </>
            )}
        </div>
      )}
    </Modal>
  );
}
