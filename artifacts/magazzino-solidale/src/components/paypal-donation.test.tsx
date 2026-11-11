import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PaypalDonationBanner, PaypalDonationButton } from "./paypal-donation";
import { sostieniProgettoConfig } from "@/lib/sostieni-progetto";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

describe("promemoria PayPal", () => {
  let host: HTMLDivElement;
  let root: Root;

  const banner = () => host.querySelector("aside");
  const advance = (milliseconds: number) => act(async () => vi.advanceTimersByTime(milliseconds));

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.useFakeTimers();
    sessionStorage.clear();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    sessionStorage.clear();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("compare a 5 minuti, si chiude al clic esterno e ricompare dopo 20 minuti", async () => {
    const onOutsideClick = vi.fn();
    await act(async () => root.render(<><button onClick={onOutsideClick}>Altra azione</button><PaypalDonationBanner /></>));

    await advance(5 * 60_000 - 1);
    expect(banner()).toBeNull();
    await advance(1);
    expect(banner()?.querySelector("a")?.href).toBe(sostieniProgettoConfig.paypalDonationUrl);
    await act(async () => banner()?.querySelector("p")?.click());
    expect(banner()).not.toBeNull();
    await act(async () => host.querySelector("button")?.click());
    expect(banner()).toBeNull();
    expect(onOutsideClick).toHaveBeenCalledOnce();

    await advance(20 * 60_000 - 1);
    expect(banner()).toBeNull();
    await advance(1);
    expect(banner()).not.toBeNull();
    await advance(7_999);
    expect(banner()).not.toBeNull();
    await advance(1);
    expect(banner()).toBeNull();
  });

  it("sospende i promemoria nella scheda dopo l’apertura del collegamento PayPal", async () => {
    await act(async () => root.render(<><PaypalDonationButton /><PaypalDonationBanner /></>));
    await advance(5 * 60_000);
    expect(banner()).not.toBeNull();

    const existingButton = host.querySelector("a")!;
    existingButton.addEventListener("click", (event) => event.preventDefault(), { once: true });
    await act(async () => existingButton.click());
    expect(banner()).toBeNull();
    await advance(20 * 60_000);
    expect(banner()).toBeNull();

    await act(async () => root.render(null));
    await act(async () => root.render(<PaypalDonationBanner />));
    await advance(25 * 60_000);
    expect(banner()).toBeNull();
  });
});
