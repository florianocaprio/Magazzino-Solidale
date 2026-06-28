import { useEffect, useState } from "react";
import {
  useGetImpostazioniStampa,
  useUpdateImpostazioniStampa,
  getGetImpostazioniStampaQueryKey,
  useGetImpostazioniEmail,
  useUpdateImpostazioniEmail,
  getGetImpostazioniEmailQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { BOLLA_TEMPLATES, type BollaTemplate } from "@/lib/bolla-pdf";
import { Check, Printer, Mail } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";

export default function ImpostazioniStampa() {
  const { t } = useTranslation();
  const { data, isLoading } = useGetImpostazioniStampa();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const update = useUpdateImpostazioniStampa();

  const [template, setTemplate] = useState<BollaTemplate>("standard");
  const [footer, setFooter] = useState("");

  useEffect(() => {
    if (data) {
      setTemplate((data.templateBolla as BollaTemplate) ?? "standard");
      setFooter(data.footerBolla ?? "");
    }
  }, [data]);

  const handleSave = () => {
    update.mutate(
      { data: { templateBolla: template, footerBolla: footer } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetImpostazioniStampaQueryKey() });
          toast({ title: t("impostazioniStampa.toastSaved") });
        },
        onError: () => toast({ title: t("impostazioniStampa.toastError"), variant: "destructive" }),
      },
    );
  };

  // ── Email settings ───────────────────────────────────────────────────────
  const { data: emailData, isLoading: emailLoading } = useGetImpostazioniEmail();
  const updateEmail = useUpdateImpostazioniEmail();
  const [provider, setProvider] = useState<"connector" | "smtp">("connector");
  const [mittenteEmail, setMittenteEmail] = useState("");
  const [mittenteNome, setMittenteNome] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState("");
  const [smtpSecure, setSmtpSecure] = useState(false);
  const [smtpUser, setSmtpUser] = useState("");
  const [smtpPassword, setSmtpPassword] = useState("");
  const [hasPassword, setHasPassword] = useState(false);

  useEffect(() => {
    if (emailData) {
      setProvider((emailData.provider as "connector" | "smtp") ?? "connector");
      setMittenteEmail(emailData.mittenteEmail ?? "");
      setMittenteNome(emailData.mittenteNome ?? "");
      setAdminEmail(emailData.adminEmail ?? "");
      setSmtpHost(emailData.smtpHost ?? "");
      setSmtpPort(emailData.smtpPort != null ? String(emailData.smtpPort) : "");
      setSmtpSecure(!!emailData.smtpSecure);
      setSmtpUser(emailData.smtpUser ?? "");
      setHasPassword(!!emailData.hasPassword);
      setSmtpPassword("");
    }
  }, [emailData]);

  // Auto-detect common SMTP host/port/security from the sender domain.
  const autodetectSmtp = () => {
    const email = (smtpUser || mittenteEmail).trim().toLowerCase();
    const domain = email.includes("@") ? email.split("@")[1] : "";
    const presets: Record<string, { host: string; port: number; secure: boolean }> = {
      "gmail.com": { host: "smtp.gmail.com", port: 587, secure: false },
      "googlemail.com": { host: "smtp.gmail.com", port: 587, secure: false },
      "outlook.com": { host: "smtp-mail.outlook.com", port: 587, secure: false },
      "hotmail.com": { host: "smtp-mail.outlook.com", port: 587, secure: false },
      "office365.com": { host: "smtp.office365.com", port: 587, secure: false },
      "yahoo.com": { host: "smtp.mail.yahoo.com", port: 465, secure: true },
      "libero.it": { host: "smtp.libero.it", port: 465, secure: true },
      "aruba.it": { host: "smtps.aruba.it", port: 465, secure: true },
      "pec.it": { host: "smtps.aruba.it", port: 465, secure: true },
    };
    const preset = presets[domain] ?? (domain ? { host: `smtp.${domain}`, port: 587, secure: false } : null);
    if (!preset) {
      toast({ title: t("impostazioniEmail.autodetectFail"), variant: "destructive" });
      return;
    }
    setSmtpHost(preset.host);
    setSmtpPort(String(preset.port));
    setSmtpSecure(preset.secure);
    toast({ title: t("impostazioniEmail.autodetectOk") });
  };

  const handleSaveEmail = () => {
    updateEmail.mutate(
      {
        data: {
          provider,
          mittenteEmail: mittenteEmail || null,
          mittenteNome: mittenteNome || null,
          adminEmail: adminEmail || null,
          smtpHost: smtpHost || null,
          smtpPort: smtpPort.trim() === "" ? null : Number(smtpPort),
          smtpSecure,
          smtpUser: smtpUser || null,
          // Only send password when the user typed something (write-only).
          ...(smtpPassword !== "" ? { smtpPassword } : {}),
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetImpostazioniEmailQueryKey() });
          toast({ title: t("impostazioniEmail.toastSaved") });
        },
        onError: () => toast({ title: t("impostazioniEmail.toastError"), variant: "destructive" }),
      },
    );
  };

  return (
    <div className="p-6 space-y-6 max-w-3xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <Printer className="h-7 w-7" /> {t("impostazioniStampa.title")}
        </h1>
        <p className="text-muted-foreground">{t("impostazioniStampa.subtitle")}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("impostazioniStampa.modelloTitle")}</CardTitle>
          <CardDescription>{t("impostazioniStampa.modelloDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="grid sm:grid-cols-3 gap-3">
              {Array(3).fill(0).map((_, i) => <Skeleton key={i} className="h-24 w-full rounded-lg" />)}
            </div>
          ) : (
            <div className="grid sm:grid-cols-3 gap-3">
              {BOLLA_TEMPLATES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setTemplate(t.value)}
                  className={cn(
                    "text-left rounded-lg border p-4 transition-colors relative",
                    template === t.value ? "border-primary ring-2 ring-primary/30 bg-primary/5" : "hover:border-muted-foreground/40",
                  )}
                >
                  {template === t.value && (
                    <span className="absolute top-2 right-2 text-primary"><Check className="h-4 w-4" /></span>
                  )}
                  <p className="font-semibold text-sm">{t.label}</p>
                  <p className="text-xs text-muted-foreground mt-1">{t.description}</p>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("impostazioniStampa.footerTitle")}</CardTitle>
          <CardDescription>{t("impostazioniStampa.footerDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="footer">{t("impostazioniStampa.footerLabel")}</Label>
            <Textarea
              id="footer"
              rows={3}
              value={footer}
              onChange={(e) => setFooter(e.target.value)}
              placeholder={t("impostazioniStampa.footerPlaceholder")}
              disabled={isLoading}
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={update.isPending || isLoading}>
          {t("impostazioniStampa.saveSettings")}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" /> {t("impostazioniEmail.title")}
          </CardTitle>
          <CardDescription>{t("impostazioniEmail.subtitle")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {emailLoading ? (
            <Skeleton className="h-40 w-full rounded-lg" />
          ) : (
            <>
              <div className="space-y-2">
                <Label>{t("impostazioniEmail.providerLabel")}</Label>
                <Select value={provider} onValueChange={(v) => setProvider(v as "connector" | "smtp")}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="connector">{t("impostazioniEmail.providerConnector")}</SelectItem>
                    <SelectItem value="smtp">{t("impostazioniEmail.providerSmtp")}</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {provider === "connector" ? t("impostazioniEmail.connectorHint") : t("impostazioniEmail.smtpHint")}
                </p>
              </div>

              <div className="grid sm:grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="mittenteEmail">{t("impostazioniEmail.mittenteEmail")}</Label>
                  <Input id="mittenteEmail" type="email" value={mittenteEmail} onChange={(e) => setMittenteEmail(e.target.value)} placeholder="info@esempio.it" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="mittenteNome">{t("impostazioniEmail.mittenteNome")}</Label>
                  <Input id="mittenteNome" value={mittenteNome} onChange={(e) => setMittenteNome(e.target.value)} placeholder="Magazzino Solidale AIM" />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="adminEmail">{t("impostazioniEmail.adminEmail")}</Label>
                <Input id="adminEmail" type="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} placeholder="amministrazione@esempio.it" />
                <p className="text-xs text-muted-foreground">{t("impostazioniEmail.adminEmailHint")}</p>
              </div>

              {provider === "smtp" && (
                <div className="space-y-4 rounded-lg border p-4">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">{t("impostazioniEmail.smtpTitle")}</p>
                    <Button type="button" variant="outline" size="sm" onClick={autodetectSmtp}>
                      {t("impostazioniEmail.autodetect")}
                    </Button>
                  </div>
                  <div className="grid sm:grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label htmlFor="smtpHost">{t("impostazioniEmail.smtpHost")}</Label>
                      <Input id="smtpHost" value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} placeholder="smtp.esempio.it" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="smtpPort">{t("impostazioniEmail.smtpPort")}</Label>
                      <Input id="smtpPort" type="number" value={smtpPort} onChange={(e) => setSmtpPort(e.target.value)} placeholder="587" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="smtpUser">{t("impostazioniEmail.smtpUser")}</Label>
                      <Input id="smtpUser" value={smtpUser} onChange={(e) => setSmtpUser(e.target.value)} placeholder="info@esempio.it" autoComplete="off" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="smtpPassword">{t("impostazioniEmail.smtpPassword")}</Label>
                      <Input
                        id="smtpPassword"
                        type="password"
                        value={smtpPassword}
                        onChange={(e) => setSmtpPassword(e.target.value)}
                        placeholder={hasPassword ? "••••••••" : ""}
                        autoComplete="new-password"
                      />
                      {hasPassword && <p className="text-xs text-muted-foreground">{t("impostazioniEmail.passwordSetHint")}</p>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch id="smtpSecure" checked={smtpSecure} onCheckedChange={setSmtpSecure} />
                    <Label htmlFor="smtpSecure" className="cursor-pointer">{t("impostazioniEmail.smtpSecure")}</Label>
                  </div>
                </div>
              )}

              <div className="flex justify-end">
                <Button onClick={handleSaveEmail} disabled={updateEmail.isPending}>
                  {t("impostazioniEmail.saveSettings")}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
