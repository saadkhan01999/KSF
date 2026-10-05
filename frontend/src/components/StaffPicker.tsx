/* ==========================================================================
   Whose figures
   --------------------------------------------------------------------------
   Everybody sees their own sales. The owner and the Super Admin
   (`reports.everyone`) see the whole pharmacy, and with this picker can open
   any one role combined ("All Cashiers") or any one person's dashboard, sales
   and reports on their own.

   It renders nothing for anybody else, so a screen can always include it.
   The server applies the same rule whatever the browser sends.
   ========================================================================== */

import { Users } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useApiData } from '../hooks/useApi';
import type { RoleOption, StaffOption } from '../types';

export function useStaffOptions() {
  const { can } = useApp();
  const { data } = useApiData<{ data: StaffOption[]; roles?: RoleOption[] }>(can('reports.everyone') ? '/reports/people' : null);
  return { people: data?.data ?? [], roles: data?.roles ?? [] };
}

/** True when the picker is on one role rather than one person. */
export const isRoleValue = (value: string) => value.startsWith('role:');

export function StaffPicker({
  value, onChange, everyoneLabel = 'Whole pharmacy'
}: { value: string; onChange: (value: string) => void; everyoneLabel?: string }) {
  const { can } = useApp();
  const { people, roles } = useStaffOptions();
  if (!can('reports.everyone')) return null;

  return (
    <label className="staff-picker">
      <Users size={16} aria-hidden="true" />
      <select
        className="select"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label="Whose figures to show"
      >
        <option value="">{everyoneLabel}</option>
        {roles.length > 0 && (
          <optgroup label="Each role, combined">
            {roles.map((role) => (
              <option key={role.id} value={`role:${role.id}`}>
                {role.plural} ({role.people})
              </option>
            ))}
          </optgroup>
        )}
        <optgroup label="Each person">
          {people.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name}{person.role ? ` — ${person.role}` : ''}
            </option>
          ))}
        </optgroup>
      </select>
    </label>
  );
}
