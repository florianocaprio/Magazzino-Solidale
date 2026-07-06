import { Router, type IRouter } from "express";
import {
  getBollaStampaSpesaEmporio,
  getSpesaEmporio,
  getSpesaEmporioBySessione,
  listSpeseEmporio,
  registraInvioManualeBollaEmporio,
  SpesaEmporioError,
} from "../lib/speseEmporio";
import {
  callerCentroId,
  callerCittaId,
  callerZonaUdsId,
  canUseBeneficiario,
} from "../lib/centroScope";
import { EMPORIO_DISABLED_MSG, isEmporioEnabled } from "../lib/impostazioniModuli";

const router: IRouter = Router();

function asInt(value: unknown): number | undefined {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function operatorId(req: import("express").Request): number | null {
  const user = req.user as { id?: unknown } | undefined;
  return typeof user?.id === "number" ? user.id : null;
}

function buildBollaLink(req: import("express").Request, spesaId: number): string {
  const provided = asText(req.body?.linkBolla);
  if (provided && (provided.startsWith("http://") || provided.startsWith("https://") || provided.startsWith("/"))) {
    return provided;
  }
  const forwardedProto = req.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const forwardedHost = req.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost ?? req.get("host");
  const relative = `/spese-emporio/${spesaId}/bolla-stampa`;
  return host ? `${forwardedProto ?? req.protocol}://${host}${relative}` : relative;
}

async function assertEmporioEnabled(res: import("express").Response): Promise<boolean> {
  if (await isEmporioEnabled()) return true;
  res.status(403).json({ error: EMPORIO_DISABLED_MSG });
  return false;
}

async function ensureSpesaAccess(spesa: { beneficiarioId: number } | null, req: import("express").Request, res: import("express").Response): Promise<boolean> {
  if (!spesa) {
    res.status(404).json({ error: "Spesa Emporio non trovata." });
    return false;
  }
  if (!(await canUseBeneficiario(spesa.beneficiarioId, callerCentroId(req), callerCittaId(req), callerZonaUdsId(req)))) {
    res.status(403).json({ error: "Risorsa non accessibile per il tuo profilo" });
    return false;
  }
  return true;
}

router.get("/spese-emporio", async (req, res) => {
  if (!(await assertEmporioEnabled(res))) return;
  const q = req.query as Record<string, string | undefined>;
  const callerCentro = callerCentroId(req);
  const callerCitta = callerCittaId(req);
  const callerZona = callerZonaUdsId(req);
  const rows = await listSpeseEmporio({
    dataDa: q.dataDa,
    dataA: q.dataA,
    beneficiarioSearch: q.beneficiarioSearch,
    beneficiarioId: asInt(q.beneficiarioId),
    magazzinoEmporioId: asInt(q.magazzinoEmporioId),
    centroAscoltoId: callerCentro ?? asInt(q.centroAscoltoId),
    cittaId: callerCitta ?? asInt(q.cittaId ?? q.areaId),
    zonaUdsId: callerZona ?? asInt(q.zonaUdsId),
  });
  res.json(rows);
});

router.get("/spese-emporio/sessione/:sessioneCassaId", async (req, res) => {
  if (!(await assertEmporioEnabled(res))) return;
  const spesa = await getSpesaEmporioBySessione(Number(req.params.sessioneCassaId));
  if (!(await ensureSpesaAccess(spesa, req, res))) return;
  res.json(spesa);
});

router.get("/spese-emporio/:id", async (req, res) => {
  if (!(await assertEmporioEnabled(res))) return;
  const spesa = await getSpesaEmporio(Number(req.params.id));
  if (!(await ensureSpesaAccess(spesa, req, res))) return;
  res.json(spesa);
});

router.get("/spese-emporio/:id/bolla-stampa", async (req, res) => {
  if (!(await assertEmporioEnabled(res))) return;
  const spesa = await getSpesaEmporio(Number(req.params.id));
  if (!(await ensureSpesaAccess(spesa, req, res))) return;
  const stampa = await getBollaStampaSpesaEmporio(Number(req.params.id));
  res.json(stampa);
});

async function handleRegistraInvioManualeBolla(req: import("express").Request, res: import("express").Response): Promise<void> {
  if (!(await assertEmporioEnabled(res))) return;
  const spesa = await getSpesaEmporio(Number(req.params.id));
  if (!(await ensureSpesaAccess(spesa, req, res))) return;
  try {
    const result = await registraInvioManualeBollaEmporio({
      spesaId: Number(req.params.id),
      operatoreId: operatorId(req),
      linkBolla: buildBollaLink(req, Number(req.params.id)),
    });
    const aggiornata = await getSpesaEmporio(Number(req.params.id));
    res.json({ ...result, spesa: aggiornata });
  } catch (err) {
    if (err instanceof SpesaEmporioError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    throw err;
  }
}

router.post("/spese-emporio/:id/registra-invio-manuale-bolla", handleRegistraInvioManualeBolla);
router.post("/spese-emporio/:id/invia-bolla-email", handleRegistraInvioManualeBolla);

export default router;
