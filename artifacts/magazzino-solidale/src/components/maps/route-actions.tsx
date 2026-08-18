import { useState } from "react";
import { getMapsRouteConsegna } from "@workspace/api-client-react";
import { Check, Copy, Navigation, Share2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { hasMapsPermission } from "@/lib/maps-access";
import { cn } from "@/lib/utils";

type RouteActionsProps = {
  consegnaId: number;
  available: boolean;
  className?: string;
  compact?: boolean;
};

function errorMessage(error: unknown, fallback: string): string {
  return (error as { data?: { error?: string } })?.data?.error
    ?? (error as { response?: { data?: { error?: string } } })?.response?.data?.error
    ?? fallback;
}

export function RouteActions({ consegnaId, available, className, compact = false }: RouteActionsProps) {
  const { user, hasPermission } = useAuth();
  const { t } = useTranslation();
  const { toast } = useToast();
  const [manualUrl, setManualUrl] = useState<string | null>(null);

  if (!available || !hasMapsPermission(user, hasPermission, "maps.route")) return null;

  const loadUrl = async (): Promise<string | null> => {
    try {
      return (await getMapsRouteConsegna(consegnaId)).url;
    } catch (error) {
      toast({
        title: t("maps.routeError"),
        description: errorMessage(error, t("maps.routeUnavailable")),
        variant: "destructive",
      });
      return null;
    }
  };

  const copyUrl = async (url: string): Promise<boolean> => {
    if (!navigator.clipboard?.writeText) {
      setManualUrl(url);
      toast({ title: t("maps.manualCopyTitle"), description: t("maps.manualCopyDescription") });
      return false;
    }
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: t("maps.routeCopied") });
      return true;
    } catch {
      setManualUrl(url);
      toast({ title: t("maps.copyError"), description: t("maps.manualCopyDescription"), variant: "destructive" });
      return false;
    }
  };

  const openRoute = async () => {
    const url = await loadUrl();
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  };

  const copyRoute = async () => {
    const url = await loadUrl();
    if (url) await copyUrl(url);
  };

  const shareRoute = async () => {
    const url = await loadUrl();
    if (!url) return;
    if (!navigator.share) {
      await copyUrl(url);
      return;
    }
    try {
      await navigator.share({
        title: t("maps.shareTitle"),
        text: t("maps.shareText"),
        url,
      });
      toast({ title: t("maps.routeShared") });
    } catch (error) {
      if ((error as { name?: string })?.name !== "AbortError") {
        toast({ title: t("maps.shareError"), variant: "destructive" });
      }
    }
  };

  const buttonClass = compact ? "h-8 px-2" : "gap-1";
  return (
    <>
      <div className={cn("flex flex-wrap items-center gap-1", className)}>
        <Button type="button" size="sm" variant="outline" className={buttonClass} onClick={openRoute} aria-label={t("maps.openRoute")}>
          <Navigation className="h-3.5 w-3.5" />{!compact && t("maps.openRoute")}
        </Button>
        <Button type="button" size="sm" variant="outline" className={buttonClass} onClick={copyRoute} aria-label={t("maps.copyRoute")}>
          <Copy className="h-3.5 w-3.5" />{!compact && t("maps.copyRoute")}
        </Button>
        <Button type="button" size="sm" variant="outline" className={buttonClass} onClick={shareRoute} aria-label={t("maps.shareRoute")}>
          <Share2 className="h-3.5 w-3.5" />{!compact && t("maps.shareRoute")}
        </Button>
      </div>
      <Dialog open={manualUrl != null} onOpenChange={(open) => { if (!open) setManualUrl(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("maps.manualCopyTitle")}</DialogTitle>
            <DialogDescription>{t("maps.manualCopyDescription")}</DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <Input
              readOnly
              value={manualUrl ?? ""}
              aria-label={t("maps.manualRouteUrl")}
              onFocus={(event) => event.currentTarget.select()}
            />
            <Check className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
