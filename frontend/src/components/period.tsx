/* A reporting period: this month, last month, this quarter, this year, or any
   two dates. The quick choices are what an owner actually asks for; the two
   date fields are there for the accountant. */

import { useMemo, useState } from 'react';
import { Segmented } from './ui';
import { date, todayIso } from '../utils/format';

export type PeriodPreset = 'month' | 'last-month' | 'quarter' | 'year' | 'custom';

export interface Period { from: string; to: string; preset: PeriodPreset }

const iso = (value: Date): string => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;

/** The dates a quick choice stands for, ending today (or the month's end). */
export function presetRange(preset: Exclude<PeriodPreset, 'custom'>, now = new Date()): { from: string; to: string } {
  const year = now.getFullYear();
  const month = now.getMonth();
  switch (preset) {
    case 'last-month':
      return { from: iso(new Date(year, month - 1, 1)), to: iso(new Date(year, month, 0)) };
    case 'quarter':
      return { from: iso(new Date(year, month - (month % 3), 1)), to: iso(now) };
    case 'year':
      return { from: iso(new Date(year, 0, 1)), to: iso(now) };
    default:
      return { from: iso(new Date(year, month, 1)), to: iso(now) };
  }
}

export function usePeriod(initial: Exclude<PeriodPreset, 'custom'> = 'month') {
  const [period, setPeriod] = useState<Period>(() => ({ ...presetRange(initial), preset: initial }));
  const label = useMemo(() => `${date(period.from)} – ${date(period.to)}`, [period.from, period.to]);
  return { period, setPeriod, label };
}

const OPTIONS: { value: PeriodPreset; label: string }[] = [
  { value: 'month', label: 'This month' },
  { value: 'last-month', label: 'Last month' },
  { value: 'quarter', label: 'This quarter' },
  { value: 'year', label: 'This year' },
  { value: 'custom', label: 'Dates' }
];

export function PeriodPicker({ value, onChange }: { value: Period; onChange: (period: Period) => void }) {
  const choose = (preset: PeriodPreset) => {
    onChange(preset === 'custom' ? { ...value, preset } : { ...presetRange(preset), preset });
  };
  return (
    <div className="period-picker">
      <Segmented value={value.preset} onChange={choose} options={OPTIONS} label="Period" />
      {value.preset === 'custom' && (
        <div className="period-dates">
          <input
            className="input" type="date" value={value.from} max={value.to} aria-label="From"
            onChange={(event) => event.target.value && onChange({ ...value, from: event.target.value })}
          />
          <span className="t-dim" aria-hidden="true">to</span>
          <input
            className="input" type="date" value={value.to} min={value.from} max={todayIso()} aria-label="To"
            onChange={(event) => event.target.value && onChange({ ...value, to: event.target.value })}
          />
        </div>
      )}
    </div>
  );
}
