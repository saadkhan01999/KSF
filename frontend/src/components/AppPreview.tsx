/* ==========================================================================
   The product "screenshot" on the public pages.
   --------------------------------------------------------------------------
   Real markup rather than an image: it stays sharp on every display, it
   follows the light and dark theme like everything else, and there is no
   picture to go stale the next time a screen changes.

   Marked aria-hidden throughout — it is an illustration of the product, and
   a screen reader announcing a fictional sales figure would be worse than
   useless. The surrounding prose carries the meaning.
   ========================================================================== */

const BARS = [38, 46, 41, 55, 62, 58, 71, 84, 77, 88, 94, 100];

export function DashboardPreview() {
  return (
    <div className="preview preview-dashboard" aria-hidden="true">
      <div className="preview-rail">
        <div className="preview-logo">KSF</div>
        {['Dashboard', 'New sale', 'Medicines', 'Inventory', 'Expiry', 'Reports'].map((label, index) => (
          <div key={label} className={`preview-rail-item ${index === 0 ? 'is-active' : ''}`}>{label}</div>
        ))}
      </div>

      <div className="preview-body">
        <div className="preview-topbar">
          <div>
            <strong>Good morning, Salman</strong>
            <span>How KSF is doing today</span>
          </div>
          <span className="preview-pill">New sale</span>
        </div>

        <div className="preview-stats">
          {[
            ['Sales today', 'Rs 12,535', 'ok'],
            ['Invoices', '13', 'info'],
            ['Low stock', '11', 'warn'],
            ['Expiring', '4', 'danger']
          ].map(([label, value, tone]) => (
            <div key={label} className="preview-stat">
              <span className="preview-stat-label">{label}</span>
              <strong className={`preview-stat-value tone-${tone}`}>{value}</strong>
            </div>
          ))}
        </div>

        <div className="preview-chart">
          <span className="preview-chart-title">Sales over the last twelve months</span>
          <div className="preview-bars">
            {BARS.map((height, index) => (
              <span key={index} className={index === 11 ? 'is-gold' : ''} style={{ height: `${height}%` }} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** A small till, used beside the point-of-sale section. */
export function TillPreview() {
  return (
    <div className="preview preview-till" aria-hidden="true">
      <div className="preview-till-head">
        <strong>New sale</strong>
        <span className="preview-pill">KSF-INV-004182</span>
      </div>
      <div className="preview-till-lines">
        {[
          ['Panadol Extra', '2 × Rs 45', 'Rs 90'],
          ['Augmentin 625mg', '1 × Rs 465', 'Rs 465'],
          ['Ventolin Inhaler', '1 × Rs 520', 'Rs 520']
        ].map(([name, detail, total]) => (
          <div key={name} className="preview-till-line">
            <span>{name}<em>{detail}</em></span>
            <strong>{total}</strong>
          </div>
        ))}
      </div>
      <div className="preview-till-total">
        <span>Total due</span>
        <strong>Rs 1,075</strong>
      </div>
      <div className="preview-till-methods">
        {['Cash', 'Card', 'Easypaisa', 'JazzCash'].map((method, index) => (
          <span key={method} className={index === 0 ? 'is-active' : ''}>{method}</span>
        ))}
      </div>
    </div>
  );
}

/** Expiry control, used beside the expiry section. */
export function ExpiryPreview() {
  return (
    <div className="preview preview-expiry" aria-hidden="true">
      <div className="preview-till-head">
        <strong>Expiry control</strong>
        <span className="preview-pill is-warn">4 need attention</span>
      </div>
      {[
        ['Actifed Syrup', 'B02463', 'Expired 2 days ago', 'danger'],
        ['Nan Pro 1', 'B02603', 'Expires in 21 days', 'warn'],
        ['Risek 20mg', 'B02711', 'Expires in 58 days', 'warn'],
        ['Brufen 400mg', 'B02840', 'Expires in 84 days', 'info']
      ].map(([name, batch, note, tone]) => (
        <div key={batch} className="preview-expiry-row">
          <span className={`preview-dot tone-${tone}`} />
          <span className="preview-expiry-name">{name}<em>Batch {batch}</em></span>
          <span className={`preview-expiry-note tone-${tone}`}>{note}</span>
        </div>
      ))}
    </div>
  );
}
