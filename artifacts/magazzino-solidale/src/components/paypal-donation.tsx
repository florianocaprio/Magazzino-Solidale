import { useEffect, useRef, useState } from "react";
import { ExternalLink, Heart } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  readPaypalReminderDeadline,
  sostieniProgettoConfig,
  writePaypalReminderDeadline,
} from "@/lib/sostieni-progetto";

const firstReminderMs = 5 * 60_000;
const repeatReminderMs = 20 * 60_000;
const reminderDurationMs = 8_000;
const paypalOpenedEvent = "magazzino:paypal-opened";

function rememberPaypalOpening() {
  writePaypalReminderDeadline(null);
  window.dispatchEvent(new Event(paypalOpenedEvent));
}

export function PaypalDonationButton({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  return (
    <Button asChild className={compact ? "shrink-0 border-transparent bg-[#ffc439] px-2.5 text-xs font-semibold text-[#003087] sm:px-4 sm:text-sm" : "w-full"}>
      <a
        href={sostieniProgettoConfig.paypalDonationUrl}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={t("sostieniProgetto.paypal.openExternalAria")}
        onClick={rememberPaypalOpening}
        onAuxClick={(event) => {
          if (event.button === 1) rememberPaypalOpening();
        }}
      >
        <Heart aria-hidden="true" />
        {t("sostieniProgetto.paypal.donate")}
        {!compact && <ExternalLink aria-hidden="true" />}
      </a>
    </Button>
  );
}

export function PaypalDonationBanner() {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  const banner = useRef<HTMLElement>(null);

  useEffect(() => {
    const savedDeadline = readPaypalReminderDeadline();
    if (savedDeadline === null) return;
    if (savedDeadline === undefined) {
      writePaypalReminderDeadline(Date.now() + firstReminderMs);
    }

    let nextReminder: number | undefined;
    const checkReminder = () => {
      window.clearTimeout(nextReminder);
      const deadline = readPaypalReminderDeadline();
      if (deadline == null || document.visibilityState === "hidden") return;

      const now = Date.now();
      if (deadline > now) {
        nextReminder = window.setTimeout(checkReminder, deadline - now);
        return;
      }

      writePaypalReminderDeadline(now + repeatReminderMs);
      setVisible(true);
      nextReminder = window.setTimeout(checkReminder, repeatReminderMs);
    };
    const stopReminders = () => {
      window.clearTimeout(nextReminder);
      setVisible(false);
    };
    document.addEventListener("visibilitychange", checkReminder);
    window.addEventListener(paypalOpenedEvent, stopReminders);
    checkReminder();
    return () => {
      window.clearTimeout(nextReminder);
      document.removeEventListener("visibilitychange", checkReminder);
      window.removeEventListener(paypalOpenedEvent, stopReminders);
    };
  }, []);

  useEffect(() => {
    if (!visible) return;

    const dismiss = () => setVisible(false);
    const dismissOutside = (event: MouseEvent) => {
      if (event.target instanceof Node && !banner.current?.contains(event.target)) dismiss();
    };
    const dismissWithEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };
    const expiry = window.setTimeout(dismiss, reminderDurationMs);
    document.addEventListener("click", dismissOutside, true);
    document.addEventListener("keydown", dismissWithEscape);
    return () => {
      window.clearTimeout(expiry);
      document.removeEventListener("click", dismissOutside, true);
      document.removeEventListener("keydown", dismissWithEscape);
    };
  }, [visible]);

  if (!visible) return null;

  return (
    <aside
      ref={banner}
      aria-label={t("nav.items.sostieniProgetto")}
      className="fixed inset-x-2 bottom-[max(0.5rem,env(safe-area-inset-bottom))] z-40 mx-auto flex w-fit max-w-[calc(100%-1rem)] items-center gap-2 rounded-lg bg-[#f1f1f1] ps-2.5 text-zinc-950 shadow-md ring-1 ring-zinc-900/10 motion-safe:animate-in motion-safe:slide-in-from-bottom-full motion-safe:duration-[350ms] sm:gap-4 sm:ps-3"
    >
      <div className="min-w-0 text-xs leading-tight sm:flex sm:items-center sm:gap-3 sm:text-sm">
        <p className="font-semibold">{t("sostieniProgetto.freeVersion")}</p>
        <p>{t("nav.items.sostieniProgetto")}</p>
      </div>
      <PaypalDonationButton compact />
    </aside>
  );
}
