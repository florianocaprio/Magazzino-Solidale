import { useEffect, useRef } from "react";

const ACTIVITY_EVENTS = [
  "mousemove",
  "mousedown",
  "keydown",
  "touchstart",
  "scroll",
  "click",
  "wheel",
] as const;

// Shared across tabs so activity in one tab keeps the others alive (the session
// is shared server-side, so an idle tab must not log out an active one).
const ACTIVITY_STORAGE_KEY = "ms-last-activity";

interface UseIdleLogoutOptions {
  enabled: boolean;
  timeoutMs: number;
  onIdle: () => void;
  keepAliveMs?: number;
  onKeepAlive?: () => void;
}

/**
 * Logs the user out after `timeoutMs` of no real user interaction in ANY open
 * tab. Activity is broadcast via localStorage so an idle tab never logs out a
 * tab that is actively being used. While the user IS active, fires
 * `onKeepAlive` at most once per `keepAliveMs` so the server-side rolling
 * session stays alive during active use that makes no network calls.
 */
export function useIdleLogout({
  enabled,
  timeoutMs,
  onIdle,
  keepAliveMs,
  onKeepAlive,
}: UseIdleLogoutOptions) {
  const onIdleRef = useRef(onIdle);
  const onKeepAliveRef = useRef(onKeepAlive);
  onIdleRef.current = onIdle;
  onKeepAliveRef.current = onKeepAlive;

  useEffect(() => {
    if (!enabled) return;

    let timer: ReturnType<typeof setTimeout>;
    let lastHandled = 0;
    let lastKeepAlive = Date.now();

    const readSharedActivity = (): number => {
      try {
        const raw = localStorage.getItem(ACTIVITY_STORAGE_KEY);
        const n = raw ? parseInt(raw, 10) : 0;
        return Number.isFinite(n) ? n : 0;
      } catch {
        return 0;
      }
    };

    const scheduleFrom = (fromTs: number) => {
      clearTimeout(timer);
      const remaining = Math.max(0, timeoutMs - (Date.now() - fromTs));
      timer = setTimeout(fire, remaining);
    };

    const fire = () => {
      // Another tab may have been active since this timer was set — re-check the
      // shared timestamp and reschedule instead of logging out an active user.
      const shared = readSharedActivity();
      const remaining = timeoutMs - (Date.now() - shared);
      if (shared && remaining > 0) {
        clearTimeout(timer);
        timer = setTimeout(fire, remaining);
        return;
      }
      onIdleRef.current();
    };

    const handleActivity = () => {
      const now = Date.now();
      if (now - lastHandled < 1000) return;
      lastHandled = now;
      try {
        localStorage.setItem(ACTIVITY_STORAGE_KEY, String(now));
      } catch {
        // ignore storage failures (private mode, quota) — local timer still works
      }
      scheduleFrom(now);
      if (
        keepAliveMs &&
        onKeepAliveRef.current &&
        now - lastKeepAlive >= keepAliveMs
      ) {
        lastKeepAlive = now;
        onKeepAliveRef.current();
      }
    };

    // Activity broadcast from another tab: reset our timer without rebroadcasting
    // (which would loop) and without firing our own keepalive.
    const handleStorage = (e: StorageEvent) => {
      if (e.key !== ACTIVITY_STORAGE_KEY || !e.newValue) return;
      const ts = parseInt(e.newValue, 10);
      scheduleFrom(Number.isFinite(ts) ? ts : Date.now());
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible") handleActivity();
    };

    // Seed activity so all tabs share a fresh baseline and start the timer.
    handleActivity();
    for (const ev of ACTIVITY_EVENTS) {
      window.addEventListener(ev, handleActivity, { passive: true });
    }
    window.addEventListener("storage", handleStorage);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      clearTimeout(timer);
      for (const ev of ACTIVITY_EVENTS) {
        window.removeEventListener(ev, handleActivity);
      }
      window.removeEventListener("storage", handleStorage);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [enabled, timeoutMs, keepAliveMs]);
}
