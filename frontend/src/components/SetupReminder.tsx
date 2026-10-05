/* The quiet half of the progressive setup: a line on the dashboard showing how
   much of the pharmacy's own details are filled in, for as long as some are
   not. It disappears on its own when the required steps are done, and stays
   away once the owner has said "later".

   Only shown to somebody who could actually do something about it — a cashier
   has no business being nagged about the DRAP licence number. */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ClipboardCheck } from 'lucide-react';
import { api } from '../services/api';
import { useApp } from '../context/AppContext';
import type { SetupState } from '../types';

export function SetupReminder({ always = false }: { always?: boolean }) {
  const { can } = useApp();
  const [state, setState] = useState<SetupState | null>(null);

  useEffect(() => {
    if (!can('settings.write')) return undefined;
    let live = true;
    api.get<{ data: SetupState }>('/setup/state')
      .then((reply) => { if (live) setState(reply.data); })
      .catch(() => { /* a reminder is not worth an error message */ });
    return () => { live = false; };
  }, [can]);

  if (!state) return null;
  /* On the dashboard the banner takes itself away once there is nothing to
     say. Under Settings it stays, because that is where somebody goes
     looking for it after saying "later". */
  if (!always && (state.complete || state.dismissed)) return null;

  const left = state.steps.filter((step) => !step.done && !step.optional).length;

  return (
    <div className="setup-banner">
      <span className="setup-tick" aria-hidden="true"><ClipboardCheck size={16} /></span>
      <div className="setup-banner-text">
        <strong>
          {state.complete
            ? 'Your pharmacy details are complete'
            : `Your pharmacy is ${state.percent}% set up`}
        </strong>
        <span>
          {state.complete
            ? 'The optional items are still there if you want them.'
            : left === 1
              ? 'One thing left — it takes a minute.'
              : `${left} things left. None of them stop you selling today.`}
        </span>
      </div>
      <div className="setup-banner-bar" role="img" aria-label={`${state.percent} per cent complete`}>
        <span style={{ width: `${state.percent}%` }} />
      </div>
      <Link to="/setup" className="btn btn-primary btn-sm">
        {state.complete ? 'Open the checklist' : 'Complete profile'} <ArrowRight size={14} />
      </Link>
    </div>
  );
}
