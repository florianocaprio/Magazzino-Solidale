import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  CheckCircle2,
  Copy,
  ExternalLink,
  Gift,
  HandHeart,
  Heart,
  Landmark,
  Mail,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { sostieniProgettoConfig } from "@/lib/sostieni-progetto";

const supportItems = [
  "itemAssistenza",
  "itemConfigurazione",
  "itemAvvio",
  "itemAggiornamenti",
  "itemOperativo",
  "itemAccompagnamento",
] as const;

function copyWithFallback(text: string): void {
  if (typeof document === "undefined") {
    throw new Error("Clipboard unavailable");
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "-1000px";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);

  try {
    textarea.focus();
    textarea.select();
    const copied = document.execCommand("copy");
    if (!copied) throw new Error("Clipboard unavailable");
  } finally {
    document.body.removeChild(textarea);
  }
}

async function copyText(text: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      copyWithFallback(text);
      return;
    }
  }

  copyWithFallback(text);
}

function buildMailto(email: string, subject: string, body: string): string {
  return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export default function SostieniProgetto() {
  const { t } = useTranslation();
  const { toast } = useToast();

  const supportMailto = useMemo(
    () =>
      buildMailto(
        sostieniProgettoConfig.supportEmail,
        t("sostieniProgetto.support.emailSubject"),
        t("sostieniProgetto.support.emailBody"),
      ),
    [t],
  );

  const handleCopyIban = async () => {
    try {
      await copyText(sostieniProgettoConfig.donationIban);
      toast({ title: t("sostieniProgetto.bank.copied") });
    } catch {
      toast({
        title: t("sostieniProgetto.bank.copyErrorTitle"),
        description: t("sostieniProgetto.bank.copyErrorDescription"),
        variant: "destructive",
      });
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <header className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="flex h-20 w-28 shrink-0 items-center justify-center rounded-lg border bg-card p-3">
            <img
              src={sostieniProgettoConfig.logoUrl}
              alt={t("sostieniProgetto.logoAlt")}
              className="max-h-full w-auto object-contain"
            />
          </div>
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">
                {t("sostieniProgetto.badges.free")}
              </Badge>
              <Badge variant="outline">
                {t("sostieniProgetto.badges.voluntary")}
              </Badge>
            </div>
            <div>
              <h1 className="text-3xl font-bold tracking-tight">
                {t("sostieniProgetto.title")}
              </h1>
              <p className="mt-2 max-w-3xl text-muted-foreground">
                {t("sostieniProgetto.subtitle")}
              </p>
            </div>
          </div>
        </div>
      </header>

      <Card>
        <CardContent className="space-y-5 pt-6">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2 md:col-span-2">
              <p className="leading-7">
                {t("sostieniProgetto.intro.paragraph1")}
              </p>
              <p className="leading-7 text-muted-foreground">
                {t("sostieniProgetto.intro.paragraph2")}
              </p>
            </div>
            <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
              <InfoLine text={t("sostieniProgetto.intro.realizedBy")} />
              <InfoLine text={t("sostieniProgetto.intro.freeDistribution")} />
              <InfoLine text={t("sostieniProgetto.intro.voluntaryDonation")} />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Landmark className="h-5 w-5" />
              {t("sostieniProgetto.bank.title")}
            </CardTitle>
            <CardDescription>
              {t("sostieniProgetto.bank.description")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <p className="text-sm font-medium">
                  {t("sostieniProgetto.bank.recipientLabel")}
                </p>
                <div className="text-sm text-muted-foreground">
                  <p>{sostieniProgettoConfig.donationRecipientName}</p>
                  {sostieniProgettoConfig.donationAddress.map((line) => (
                    <p key={line}>{line}</p>
                  ))}
                </div>
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium">
                  {t("sostieniProgetto.bank.reasonLabel")}
                </p>
                <p className="text-sm text-muted-foreground">
                  {sostieniProgettoConfig.donationReason}
                </p>
              </div>
            </div>

            <Separator />

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 space-y-1">
                <p className="text-sm font-medium">
                  {t("sostieniProgetto.bank.ibanLabel")}
                </p>
                <code
                  dir="ltr"
                  className="block break-all rounded-md bg-muted px-3 py-2 font-mono text-sm"
                >
                  {sostieniProgettoConfig.donationIban}
                </code>
              </div>
              <Button
                type="button"
                onClick={handleCopyIban}
                aria-label={t("sostieniProgetto.bank.copyIbanAria")}
                className="w-full sm:w-auto"
              >
                <Copy className="h-4 w-4" />
                {t("sostieniProgetto.bank.copyIban")}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Gift className="h-5 w-5" />
              {t("sostieniProgetto.paypal.title")}
            </CardTitle>
            <CardDescription>
              {t("sostieniProgetto.paypal.description")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild className="w-full">
              <a
                href={sostieniProgettoConfig.paypalDonationUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={t("sostieniProgetto.paypal.openExternalAria")}
              >
                <Heart className="h-4 w-4" />
                {t("sostieniProgetto.paypal.donate")}
                <ExternalLink className="h-4 w-4" />
              </a>
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HandHeart className="h-5 w-5" />
            {t("sostieniProgetto.support.title")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-3">
            <p className="leading-7">
              {t("sostieniProgetto.support.paragraph1")}
            </p>
            <p className="text-sm font-medium">
              {t("sostieniProgetto.support.introList")}
            </p>
            <ul className="grid gap-2 sm:grid-cols-2">
              {supportItems.map((item) => (
                <li key={item} className="flex items-start gap-2 text-sm">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <span>{t(`sostieniProgetto.support.${item}`)}</span>
                </li>
              ))}
            </ul>
            <p className="leading-7 text-muted-foreground">
              {t("sostieniProgetto.support.paragraph2")}
            </p>
          </div>

          <Separator />

          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="space-y-1">
              <p className="text-sm font-medium">
                {t("sostieniProgetto.support.contactLabel")}
              </p>
              <a
                href={`mailto:${sostieniProgettoConfig.supportEmail}`}
                className="inline-flex items-center gap-2 text-sm text-primary underline-offset-4 hover:underline"
              >
                <Mail className="h-4 w-4" />
                {sostieniProgettoConfig.supportEmail}
              </a>
            </div>
            <Button asChild className="w-full md:w-auto">
              <a
                href={supportMailto}
                aria-label={t("sostieniProgetto.support.requestInfoAria")}
              >
                <Mail className="h-4 w-4" />
                {t("sostieniProgetto.support.requestInfo")}
              </a>
            </Button>
          </div>
        </CardContent>
      </Card>

      <Alert>
        <AlertDescription>{t("sostieniProgetto.finalNote")}</AlertDescription>
      </Alert>
    </div>
  );
}

function InfoLine({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2 text-sm">
      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
      <span>{text}</span>
    </div>
  );
}
