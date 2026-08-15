import { useCallback, useEffect, useMemo, useState } from "react";

export function useTimer() {
  const [startedAt, setStartedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);

  const reset = useCallback(() => {
    const value = Date.now();
    setStartedAt(value);
    setNow(value);
  }, []);

  const value = useMemo(() => {
    const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
    const minutes = Math.floor(seconds / 60);
    return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  }, [now, startedAt]);

  return { value, reset };
}
