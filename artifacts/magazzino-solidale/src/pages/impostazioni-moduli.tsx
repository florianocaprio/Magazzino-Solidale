import {
  getGetImpostazioniModuliQueryKey,
  useUpdateImpostazioniModuli,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useModuloFlags } from "@/lib/use-moduli";

function errorMessage(err: unknown, fallback: string) {
  return (
    (err as { data?: { error?: string } })?.data?.error ??
    (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
    fallback
  );
}

export default function ImpostazioniModuli() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { emporioAbilitato, unitaStradaAbilitata } = useModuloFlags();
  const update = useUpdateImpostazioniModuli({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetImpostazioniModuliQueryKey() });
        toast({ title: t("moduli.saved") });
      },
      onError: (err) => {
        toast({
          title: t("moduli.title"),
          description: errorMessage(err, t("moduli.error")),
          variant: "destructive",
        });
      },
    },
  });

  const badge = (enabled: boolean) => (
    <Badge variant="outline" className={enabled ? "bg-emerald-500/10 text-emerald-700" : "bg-muted text-muted-foreground"}>
      {enabled ? t("moduli.enabled") : t("moduli.disabled")}
    </Badge>
  );

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t("moduli.title")}</h1>
        <p className="text-muted-foreground">{t("moduli.subtitle")}</p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div className="space-y-1">
            <CardTitle>{t("moduli.emporioTitle")}</CardTitle>
            <p className="text-sm text-muted-foreground">{t("moduli.emporioDescription")}</p>
          </div>
          {badge(emporioAbilitato)}
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-4">
          <p className="text-sm">{emporioAbilitato ? t("moduli.emporioOn") : t("moduli.emporioOff")}</p>
          <Switch
            checked={emporioAbilitato}
            disabled={update.isPending}
            onCheckedChange={(checked) => update.mutate({ data: { emporioAbilitato: checked } })}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div className="space-y-1">
            <CardTitle>{t("moduli.udsTitle")}</CardTitle>
            <p className="text-sm text-muted-foreground">{t("moduli.udsDescription")}</p>
          </div>
          {badge(unitaStradaAbilitata)}
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-4">
          <p className="text-sm">{unitaStradaAbilitata ? t("moduli.udsOn") : t("moduli.udsOff")}</p>
          <Switch
            checked={unitaStradaAbilitata}
            disabled={update.isPending}
            onCheckedChange={(checked) => update.mutate({ data: { unitaStradaAbilitata: checked } })}
          />
        </CardContent>
      </Card>
    </div>
  );
}
