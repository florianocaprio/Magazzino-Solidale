import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useIdleLogout } from "./use-idle-logout";

function Harness({
  onWarning,
  onResume,
  onIdle,
  onKeepAlive,
}: {
  onWarning: () => void;
  onResume: () => void;
  onIdle: () => void;
  onKeepAlive: () => Promise<void>;
}) {
  const continueSession = useIdleLogout({
    enabled: true,
    timeoutMs: 15 * 60_000,
    warningMs: 2 * 60_000,
    keepAliveMs: 5 * 60_000,
    onWarning,
    onResume,
    onIdle,
    onKeepAlive,
  });
  return <button onClick={() => void continueSession()}>continue</button>;
}

describe("useIdleLogout", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-25T10:00:00Z"));
    localStorage.clear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    localStorage.clear();
    vi.useRealTimers();
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = false;
  });

  it("avvisa due minuti prima, rinnova davvero e poi riparte dal nuovo termine", async () => {
    const onWarning = vi.fn();
    const onResume = vi.fn();
    const onIdle = vi.fn();
    const onKeepAlive = vi.fn(async () => {});
    await act(async () =>
      root.render(
        <Harness
          onWarning={onWarning}
          onResume={onResume}
          onIdle={onIdle}
          onKeepAlive={onKeepAlive}
        />,
      ),
    );

    await act(async () => vi.advanceTimersByTime(13 * 60_000));
    expect(onWarning).toHaveBeenCalledTimes(1);
    expect(onIdle).not.toHaveBeenCalled();

    await act(async () => container.querySelector("button")?.click());
    expect(onKeepAlive).toHaveBeenCalledTimes(1);
    expect(onResume).toHaveBeenCalledTimes(1);

    await act(async () => vi.advanceTimersByTime(13 * 60_000));
    expect(onWarning).toHaveBeenCalledTimes(2);
    await act(async () => vi.advanceTimersByTime(2 * 60_000));
    expect(onIdle).toHaveBeenCalledTimes(1);
  });
});
