import { useCallback, useEffect, useRef } from "react";

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
  warningMs?: number;
  onWarning?: () => void;
  onResume?: () => void;
  keepAliveMs?: number;
  onKeepAlive?: () => void | Promise<void>;
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
  warningMs,
  onWarning,
  onResume,
  keepAliveMs,
  onKeepAlive,
}: UseIdleLogoutOptions) {
  const onIdleRef = useRef(onIdle);
  const onWarningRef = useRef(onWarning);
  const onResumeRef = useRef(onResume);
  const onKeepAliveRef = useRef(onKeepAlive);
  const continueSessionRef = useRef<() => Promise<void>>(async () => {});
  onIdleRef.current = onIdle;
  onWarningRef.current = onWarning;
  onResumeRef.current = onResume;
  onKeepAliveRef.current = onKeepAlive;

  useEffect(() => {
    if (!enabled) return;

    let idleTimer: ReturnType<typeof setTimeout>;
    let warningTimer: ReturnType<typeof setTimeout>;
    let lastHandled = 0;
    let lastKeepAlive = Date.now();
    let warningVisible = false;
    let renewalPending = false;

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
      clearTimeout(idleTimer);
      clearTimeout(warningTimer);
      const remaining = Math.max(0, timeoutMs - (Date.now() - fromTs));
      idleTimer = setTimeout(fireIdle, remaining);
      if (warningMs && onWarningRef.current) {
        warningTimer = setTimeout(
          fireWarning,
          Math.max(0, remaining - warningMs),
        );
      }
    };

    const fireIdle = () => {
      // Another tab may have been active since this timer was set — re-check the
      // shared timestamp and reschedule instead of logging out an active user.
      const shared = readSharedActivity();
      const remaining = timeoutMs - (Date.now() - shared);
      if (shared && remaining > 0) {
        scheduleFrom(shared);
        return;
      }
      onIdleRef.current();
    };

    const fireWarning = () => {
      const shared = readSharedActivity();
      const remaining = timeoutMs - (Date.now() - shared);
      if (shared && warningMs && remaining > warningMs) {
        scheduleFrom(shared);
        return;
      }
      warningVisible = true;
      onWarningRef.current?.();
    };

    const recordActivity = (now: number) => {
      try {
        localStorage.setItem(ACTIVITY_STORAGE_KEY, String(now));
      } catch {
        // ignore storage failures (private mode, quota) — local timers still work
      }
      scheduleFrom(now);
    };

    const renewSession = async () => {
      if (renewalPending) return;
      renewalPending = true;
      clearTimeout(idleTimer);
      clearTimeout(warningTimer);
      try {
        await onKeepAliveRef.current?.();
        const now = Date.now();
        lastKeepAlive = now;
        warningVisible = false;
        recordActivity(now);
        onResumeRef.current?.();
      } catch (error) {
        const shared = readSharedActivity();
        scheduleFrom(shared || Date.now() - timeoutMs);
        throw error;
      } finally {
        renewalPending = false;
      }
    };
    continueSessionRef.current = renewSession;

    const handleActivity = () => {
      // Once the warning is visible, local activity is not consent to renew the
      // session. Only the explicit Continue action may call renewSession().
      // Cross-tab activity remains handled separately by handleStorage().
      if (warningVisible) return;
      const now = Date.now();
      if (now - lastHandled < 1000) return;
      lastHandled = now;
      recordActivity(now);
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
      const activityTs = Number.isFinite(ts) ? ts : Date.now();
      if (warningVisible) {
        warningVisible = false;
        onResumeRef.current?.();
      }
      scheduleFrom(activityTs);
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
      clearTimeout(idleTimer);
      clearTimeout(warningTimer);
      continueSessionRef.current = async () => {};
      for (const ev of ACTIVITY_EVENTS) {
        window.removeEventListener(ev, handleActivity);
      }
      window.removeEventListener("storage", handleStorage);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [enabled, timeoutMs, warningMs, keepAliveMs]);

  return useCallback(() => continueSessionRef.current(), []);
}
