import { useEffect, type Dispatch, type SetStateAction } from "react";

/** Keep errors visible for retry; remove successful status messages without changing focus. */
export function useAutoDismissFeedback(
  message: string,
  isError: boolean,
  setMessage: Dispatch<SetStateAction<string>>,
  delayMs = 4_000,
) {
  useEffect(() => {
    if (!message || isError) return;
    const timer = window.setTimeout(() => setMessage(""), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs, isError, message, setMessage]);
}
