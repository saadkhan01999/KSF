/* Every feature, grouped, with an anchor for each group so the other pages
   and the footer can link straight to the part somebody was reading about. */

import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowRight, Check } from 'lucide-react';
import { SitePage, SiteCta } from '../../components/SiteChrome';
import { useParallax, useReveal, useViewMode } from '../../hooks/useParallax';
import { FEATURE_SECTIONS } from './content';

export default function Features() {
  useViewMode('site');
  useReveal([]);
  const location = useLocation();
  const glow = useParallax<HTMLDivElement>({ speed: 0.3, max: 130 });

  /* A link to /features#migration should land on that group, not the top.
     React Router does not scroll to a hash by itself. */
  useEffect(() => {
    if (!location.hash) return;
    const target = document.querySelector(location.hash);
    if (target) window.requestAnimationFrame(() => target.scrollIntoView({ block: 'start' }));
  }, [location.hash]);

  return (
    <SitePage>
      <section className="page-hero is-short">
        <div className="hero-bg" aria-hidden="true">
          <div className="hero-blob two" ref={glow} />
        </div>
        <div className="page-hero-inner">
          <span className="eyebrow">Features</span>
          <h1>What is actually in it</h1>
          <p className="lede">
            Six areas, and the reason each one exists. Nothing here is on the list because it
            demonstrates well — every item is something a pharmacy asked for or something that
            went wrong without it.
          </p>
        </div>
      </section>

      <nav className="feature-jump" aria-label="Feature groups">
        {FEATURE_SECTIONS.map((section) => (
          <a key={section.id} href={`#${section.id}`}>{section.title}</a>
        ))}
      </nav>

      {FEATURE_SECTIONS.map((section, index) => (
        <section
          key={section.id}
          id={section.id}
          className={`band feature-band ${index % 2 === 1 ? 'band-tint' : ''}`}
          data-reveal
        >
          <div className="band-head is-left">
            <span className="eyebrow">{String(index + 1).padStart(2, '0')}</span>
            <h2>{section.title}</h2>
            <p>{section.lede}</p>
          </div>

          <dl className="feature-list">
            {section.items.map(([title, body]) => (
              <div key={title} className="feature-item">
                <dt><Check size={15} aria-hidden="true" /> {title}</dt>
                <dd>{body}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}

      <section className="band" data-reveal>
        <div className="band-head">
          <span className="eyebrow">Which plan has what</span>
          <h2>Every plan includes the safety features</h2>
          <p>
            Batch tracking, expiry control and the audit trail are on every plan including the
            free one. What the paid plans add is scale and analysis, never safety.
          </p>
        </div>
        <div className="band-actions">
          <Link to="/pricing" className="btn btn-primary btn-pill">
            See the plans <ArrowRight size={15} />
          </Link>
        </div>
      </section>

      <SiteCta />
    </SitePage>
  );
}
