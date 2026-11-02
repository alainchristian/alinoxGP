import { useEffect, useState } from 'react';

/** A clock that re-renders its component every `intervalMs`, so relative times ("12 s ago") keep counting without any request. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
