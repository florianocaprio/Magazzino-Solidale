import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ReadQueryFeedback, readFailureKind } from "./read-query-feedback";
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

it.each([401, 403, 500, 503, undefined])(
  "classifies cold/warm %s without confusing absence and failure",
  (status) => {
    for (const warm of [false, true]) {
      const expected =
        status === 401 || status === 403 ? "denied" : warm ? "stale" : "failed";
      expect(readFailureKind({ status }, warm)).toBe(expected);
      expect(readFailureKind({ response: { status } }, warm)).toBe(expected);
    }
  },
);

it("never exposes previous data or backend details, retries only on explicit action and clears on recovery", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host),
    refetch = vi.fn();
  const query = {
    isError: true,
    error: { status: 403, message: "private-detail" },
    data: ["protected-row"],
    isFetching: false,
    refetch,
  };
  try {
    await act(async () => root.render(<ReadQueryFeedback query={query} />));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "common.readdenied",
    );
    expect(host.textContent).not.toMatch(/protected-row|private-detail/);
    expect(refetch).not.toHaveBeenCalled();
    await act(async () => host.querySelector("button")!.click());
    expect(refetch).toHaveBeenCalledTimes(1);
    await act(async () =>
      root.render(<ReadQueryFeedback query={{ ...query, isFetching: true }} />),
    );
    expect(host.querySelector("button")!.disabled).toBe(true);
    await act(async () =>
      root.render(<ReadQueryFeedback query={{ ...query, isError: false }} />),
    );
    expect(host.querySelector('[role="alert"]')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
