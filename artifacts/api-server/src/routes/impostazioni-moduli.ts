import { Router, type IRouter } from "express";
import { getImpostazioniModuli, updateImpostazioniModuli } from "../lib/impostazioniModuli";
import { listModuliFunzionali } from "../lib/configurazioneAmbiente";
import { auditMetaFromRequest, logConfigurazioneAudit } from "../lib/auditConfigurazioni";
import { requireSuperAdmin } from "../middlewares/auth";

const router: IRouter = Router();

function parseBoolean(value: unknown, field: string): { value?: boolean; error?: string } {
  if (value === undefined) return {};
  if (typeof value === "boolean") return { value };
  return { error: `${field} deve essere booleano.` };
}

router.get("/impostazioni-moduli", async (_req, res) => {
  res.json(await getImpostazioniModuli());
});

router.patch("/impostazioni-moduli", requireSuperAdmin, async (req, res) => {
  const body = req.body ?? {};
  const emporio = parseBoolean(body.emporioAbilitato, "emporioAbilitato");
  if (emporio.error) {
    res.status(400).json({ error: emporio.error });
    return;
  }
  const uds = parseBoolean(body.unitaStradaAbilitata, "unitaStradaAbilitata");
  if (uds.error) {
    res.status(400).json({ error: uds.error });
    return;
  }
  const updates = {
    ...(emporio.value !== undefined ? { emporioAbilitato: emporio.value } : {}),
    ...(uds.value !== undefined ? { unitaStradaAbilitata: uds.value } : {}),
  };
  const before = await listModuliFunzionali();
  const result = await updateImpostazioniModuli(updates, req.user?.id ?? null);
  const after = await listModuliFunzionali();

  for (const [field, codice] of [
    ["emporioAbilitato", "EMPORIO_SOLIDALE"],
    ["unitaStradaAbilitata", "UDS"],
  ] as const) {
    if (updates[field] === undefined) continue;
    const previous = before.find((modulo) => modulo.codice === codice);
    const current = after.find((modulo) => modulo.codice === codice);
    if (!previous || !current || previous.attivo === current.attivo) continue;
    await logConfigurazioneAudit({
      area: "moduli_funzionali",
      chiave: codice,
      azione: "toggle",
      valorePrecedente: { ...previous },
      valoreNuovo: { ...current },
      note: "Aggiornamento tramite endpoint legacy /impostazioni-moduli",
      ...auditMetaFromRequest(req),
    });
  }

  res.json(result);
});

export default router;
