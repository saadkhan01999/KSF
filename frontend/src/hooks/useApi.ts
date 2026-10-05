/* Small data-loading helpers shared by every screen. */

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../services/api';
import { useApp } from '../context/AppContext';

/** Loads a URL, re-loads when it changes, and exposes a manual reload for
    after a save. Stale responses from a superseded request are discarded, so
    typing quickly in a filter never shows the wrong list. */
export function useApiData<T>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);
  const { fail } = useApp();

  const load = useCallback(async (quiet = false) => {
    if (!path) { setLoading(false); return; }
    requestId.current += 1;
    const mine = requestId.current;
    if (!quiet) setLoading(true);
    try {
      const result = await api.get<T>(path);
      if (mine === requestId.current) { setData(result); setError(null); }
    } catch (problem) {
      if (mine === requestId.current) {
        const message = problem instanceof Error ? problem.message : 'That could not be loaded.';
        setError(message);
        if (!quiet) fail(problem);
      }
    } finally {
      if (mine === requestId.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  useEffect(() => { void load(); }, deps.length ? [...deps, load] : [load]);

  return { data, loading, error, reload: load, setData };
}

/** Delays a value so a search box does not fire a request per keystroke. */
export function useDebounced<T>(value: T, delay = 320): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return settled;
}

/** Tracks a busy flag around an async action, and reports failures once. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const { fail } = useApp();

  const run = useCallback(async <T,>(work: () => Promise<T>, onDone?: (result: T) => void): Promise<T | null> => {
    setBusy(true);
    try {
      const result = await work();
      onDone?.(result);
      return result;
    } catch (problem) {
      fail(problem);
      return null;
    } finally {
      setBusy(false);
    }
  }, [fail]);

  return { busy, run };
}

/** Sorting state for a table column header. */
export function useSort(initialField: string, initialDirection: 'asc' | 'desc' = 'desc') {
  const [sort, setSort] = useState(initialField);
  const [dir, setDir] = useState<'asc' | 'desc'>(initialDirection);
  const onSort = useCallback((field: string) => {
    setSort((current) => {
      if (current === field) { setDir((d) => (d === 'asc' ? 'desc' : 'asc')); return current; }
      setDir('asc');
      return field;
    });
  }, []);
  return { sort, dir, onSort };
}
