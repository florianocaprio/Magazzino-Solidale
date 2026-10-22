import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useConfigurazioneAmbienteFlags } from "@/lib/use-moduli";
import { downloadConsegnaBolla } from "@/lib/consegna-bolla-download";

export function ConsegnaBollaDownload({
  consegnaId,
  bollaStato,
}: {
  consegnaId: number;
  bollaStato?: string | null;
}) {
  const [pending, setPending] = useState(false);
  const { toast } = useToast();
  const { isModuloAttivo } = useConfigurazioneAmbienteFlags();
  if (
    !bollaStato ||
    !["confermato", "in_trasporto", "consegnato"].includes(bollaStato) ||
    !isModuloAttivo("BOLLE") ||
    !isModuloAttivo("MAGAZZINO_SOLIDALE")
  )
    return null;
  return (
    <Button
      type="button"
      variant="outline"
      className="min-h-11 gap-2"
      disabled={pending}
      onClick={async () => {
        if (pending) return;
        setPending(true);
        try {
          await downloadConsegnaBolla(consegnaId);
        } catch (error) {
          toast({
            title: "Download bolla non riuscito",
            description:
              error instanceof Error
                ? error.message
                : "Riprova dalla consegna.",
            variant: "destructive",
          });
        } finally {
          setPending(false);
        }
      }}
    >
      {pending ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Download className="h-4 w-4" />
      )}
      Scarica bolla trasporto
    </Button>
  );
}
