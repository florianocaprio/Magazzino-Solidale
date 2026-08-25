import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useIdleLogout } from "./use-idle-logout";

function Harness({
  onWarning,
  onResume,
  onIdle,
  onKeepAlive,
  onExit = () => {},
}: {
  onWarning: () => void;
  onResume: () => void;
  onIdle: () => void;
  onKeepAlive: () => Promise<void>;
  onExit?: () => void;
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
  return (
    <>
      <button onClick={() => void continueSession()}>continue</button>
      <button onClick={onExit}>exit</button>
    </>
  );
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

  it("mostra il warning dopo tredici minuti senza eseguire logout", async () => {
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
    expect(onKeepAlive).not.toHaveBeenCalled();
  });

  it("rinnova esplicitamente e riparte dal nuovo termine", async () => {
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

  it.each(["touchstart", "mousemove"])(
    "non rinnova per attività locale %s mentre il warning è visibile",
    async (eventName) => {
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

      await act(async () =>
        window.dispatchEvent(new Event(eventName, { bubbles: true })),
      );
      expect(onKeepAlive).not.toHaveBeenCalled();
      expect(onResume).not.toHaveBeenCalled();

      await act(async () => vi.advanceTimersByTime(2 * 60_000));
      expect(onIdle).toHaveBeenCalledTimes(1);
    },
  );

  it("esce dal warning senza generare un keepalive", async () => {
    const onWarning = vi.fn();
    const onResume = vi.fn();
    const onIdle = vi.fn();
    const onKeepAlive = vi.fn(async () => {});
    const onExit = vi.fn();
    await act(async () =>
      root.render(
        <Harness
          onWarning={onWarning}
          onResume={onResume}
          onIdle={onIdle}
          onKeepAlive={onKeepAlive}
          onExit={onExit}
        />,
      ),
    );

    await act(async () => vi.advanceTimersByTime(13 * 60_000));
    const exitButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "exit",
    )!;
    await act(async () => {
      exitButton.dispatchEvent(new Event("touchstart", { bubbles: true }));
      exitButton.click();
    });

    expect(onExit).toHaveBeenCalledTimes(1);
    expect(onKeepAlive).not.toHaveBeenCalled();
    expect(onResume).not.toHaveBeenCalled();
  });

  it("accetta attività cross-tab durante il warning senza keepalive locale", async () => {
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
    const activityTs = Date.now();
    await act(async () =>
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "ms-last-activity",
          newValue: String(activityTs),
        }),
      ),
    );

    expect(onResume).toHaveBeenCalledTimes(1);
    expect(onKeepAlive).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(13 * 60_000 - 1));
    expect(onWarning).toHaveBeenCalledTimes(1);
    expect(onIdle).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(1));
    expect(onWarning).toHaveBeenCalledTimes(2);
  });
});
