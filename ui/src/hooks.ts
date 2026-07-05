import { useCallback, useEffect, useRef, useState } from 'react';

export interface ApiState<T> {
  data: T | null;
  error: unknown;
  loading: boolean;
  reload: () => void;
}

/** Fetch-on-mount with reload; ignores results from superseded requests. */
export function useApi<T>(fn: () => Promise<T>, deps: unknown[] = []): ApiState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const gen = useRef(0);

  const run = useCallback(() => {
    const g = ++gen.current;
    setLoading(true);
    fn().then(
      (d) => { if (gen.current === g) { setData(d); setError(null); setLoading(false); } },
      (e) => { if (gen.current === g) { setError(e); setLoading(false); } },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => { run(); }, [run]);

  return { data, error, loading, reload: run };
}
