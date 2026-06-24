import { useEffect, useState } from "react";
import { useGetImpostazioniStampa, useUpdateImpostazioniStampa, getGetImpostazioniStampaQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { BOLLA_TEMPLATES, type BollaTemplate } from "@/lib/bolla-pdf";
import { Check, Printer } from "lucide-react";
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
    </div>
  );
}
