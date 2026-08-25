import {
  focusManager,
  onlineManager,
  QueryObserver,
} from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAppQueryClient } from "./query-client";

beforeEach(() => {
  focusManager.setFocused(true);
  onlineManager.setOnline(true);
});

afterEach(() => {
  focusManager.setFocused(true);
  onlineManager.setOnline(true);
});

describe("QueryClient operativo", () => {
  it("abilita refetch su focus e riconnessione con una finestra stale limitata", () => {
    const defaults = createAppQueryClient().getDefaultOptions().queries;
    expect(defaults?.staleTime).toBe(30_000);
    expect(defaults?.refetchOnWindowFocus).toBe(true);
    expect(defaults?.refetchOnReconnect).toBe(true);
  });

  it("refetcha una query attiva e stale al ritorno in foreground", async () => {
    const client = createAppQueryClient();
    client.mount();
    const queryFn = vi.fn(async () => ({ updated: Date.now() }));
    const observer = new QueryObserver(client, {
      queryKey: ["focus-operativo"],
      queryFn,
      staleTime: 0,
    });
    const unsubscribe = observer.subscribe(() => {});
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(1));
    const callsBeforeFocus = queryFn.mock.calls.length;

    focusManager.setFocused(false);
    focusManager.setFocused(true);
    await vi.waitFor(() =>
      expect(queryFn.mock.calls.length).toBeGreaterThan(callsBeforeFocus),
    );

    unsubscribe();
    client.unmount();
    client.clear();
  });

  it("refetcha una query attiva e stale dopo la riconnessione", async () => {
    const client = createAppQueryClient();
    client.mount();
    const queryFn = vi.fn(async () => ({ updated: Date.now() }));
    const observer = new QueryObserver(client, {
      queryKey: ["reconnect-operativo"],
      queryFn,
      staleTime: 0,
    });
    const unsubscribe = observer.subscribe(() => {});
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(1));
    const callsBeforeReconnect = queryFn.mock.calls.length;

    onlineManager.setOnline(false);
    onlineManager.setOnline(true);
    await vi.waitFor(() =>
      expect(queryFn.mock.calls.length).toBeGreaterThan(callsBeforeReconnect),
    );

    unsubscribe();
    client.unmount();
    client.clear();
  });
});
