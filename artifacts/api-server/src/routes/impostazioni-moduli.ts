import { Router, type IRouter } from "express";
import { getImpostazioniModuli, updateImpostazioniModuli } from "../lib/impostazioniModuli";
import { requireAdmin } from "../middlewares/auth";

const router: IRouter = Router();

function parseBoolean(value: unknown, field: string): { value?: boolean; error?: string } {
  if (value === undefined) return {};
  if (typeof value === "boolean") return { value };
  return { error: `${field} deve essere booleano.` };
}

router.get("/impostazioni-moduli", async (_req, res) => {
  res.json(await getImpostazioniModuli());
});

router.patch("/impostazioni-moduli", requireAdmin, async (req, res) => {
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
  res.json(await updateImpostazioniModuli({
    ...(emporio.value !== undefined ? { emporioAbilitato: emporio.value } : {}),
    ...(uds.value !== undefined ? { unitaStradaAbilitata: uds.value } : {}),
  }));
});

export default router;
