import { Router, type IRouter } from "express";
import {
  getBollaStampaSpesaEmporio,
  getSpesaEmporio,
  getSpesaEmporioBySessione,
  listSpeseEmporio,
  registraInvioManualeBollaEmporio,
  SpesaEmporioError,
  stornaSpesaEmporio,
} from "../lib/speseEmporio";
import {
  callerCentroId,
  callerAreaOperativaId,
  callerZonaUdsId,
  canAccessMagazzino,
  canUseBeneficiario,
  visibleMagazzinoIds,
} from "../lib/centroScope";
import {
  EMPORIO_DISABLED_MSG,
  isEmporioEnabled,
} from "../lib/impostazioniModuli";
import { requireModulo } from "../lib/featureFlags";
import { requirePermission } from "../middlewares/auth";
import { resolveSessionRuntimeConfig } from "../lib/sessionConfig";
import {
  InventoryDecimal,
  InventoryDecimalError,
  positiveInventoryDecimal,
} from "../lib/inventoryDecimal";

const router: IRouter = Router();
router.use(
  "/spese-emporio",
  requireModulo("EMPORIO_SOLIDALE", EMPORIO_DISABLED_MSG),
);

function asInt(value: unknown): number | undefined {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : NaN;
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asPositiveQuantity(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  try {
    const quantity = positiveInventoryDecimal(value);
    return quantity.compare(InventoryDecimal.parse("99999999.99")) <= 0
      ? quantity.toDb()
      : null;
  } catch (error) {
    if (error instanceof InventoryDecimalError) return null;
    throw error;
  }
}

function operatorId(req: import("express").Request): number | null {
  const user = req.user as { id?: unknown } | undefined;
  return typeof user?.id === "number" ? user.id : null;
}

function buildBollaLink(
  req: import("express").Request,
  spesaId: number,
): string {
  const relative = `/api/spese-emporio/${spesaId}/bolla-stampa`;
  const configured = process.env.PUBLIC_APP_URL?.trim().replace(/\/+$/, "");
  if (configured && /^https?:\/\//i.test(configured))
    return `${configured}${relative}`;
  const origin = req.get("origin")?.trim().replace(/\/+$/, "");
  if (origin && resolveSessionRuntimeConfig().allowedOrigins.has(origin)) {
    return `${origin}${relative}`;
  }
  return relative;
}

async function assertEmporioEnabled(
  res: import("express").Response,
): Promise<boolean> {
  if (await isEmporioEnabled()) return true;
  res.status(403).json({ error: EMPORIO_DISABLED_MSG });
  return false;
}

async function ensureSpesaAccess(
  spesa: { beneficiarioId: number; magazzinoEmporioId: number } | null,
  req: import("express").Request,
  res: import("express").Response,
): Promise<boolean> {
  if (!spesa) {
    res.status(404).json({ error: "Spesa Emporio non trovata." });
    return false;
  }
  if (
    !(await canUseBeneficiario(
      spesa.beneficiarioId,
      callerCentroId(req),
      callerAreaOperativaId(req),
      callerZonaUdsId(req),
    ))
  ) {
    res
      .status(403)
      .json({ error: "Risorsa non accessibile per il tuo profilo" });
    return false;
  }
  if (
    !(await canAccessMagazzino(
      spesa.magazzinoEmporioId,
      callerCentroId(req),
      callerAreaOperativaId(req),
    ))
  ) {
    res
      .status(403)
      .json({ error: "Risorsa non accessibile per il tuo profilo" });
    return false;
  }
  return true;
}

router.get(
  "/spese-emporio",
  requirePermission("emporio.sales.view"),
  async (req, res) => {
    if (!(await assertEmporioEnabled(res))) return;
    const q = req.query as Record<string, string | undefined>;
    const callerCentro = callerCentroId(req);
    const callerAreaOperativa = callerAreaOperativaId(req);
    const callerZona = callerZonaUdsId(req);
    const page = q.page == null ? 1 : Number(q.page);
    const limit = q.limit == null ? 50 : Number(q.limit);
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100
    ) {
      res.status(400).json({
        error:
          "Paginazione non valida: page >= 1 e limit compreso tra 1 e 100.",
      });
      return;
    }
    const result = await listSpeseEmporio({
      dataDa: q.dataDa,
      dataA: q.dataA,
      beneficiarioSearch: q.beneficiarioSearch,
      beneficiarioId: asInt(q.beneficiarioId),
      magazzinoEmporioId: asInt(q.magazzinoEmporioId),
      centroAscoltoId: callerCentro ?? asInt(q.centroAscoltoId),
      areaOperativaId: callerAreaOperativa ?? asInt(q.areaOperativaId ?? q.areaId),
      zonaUdsId: callerZona ?? asInt(q.zonaUdsId),
      visibleMagazzinoIds: await visibleMagazzinoIds(callerCentro, callerAreaOperativa),
      page,
      limit,
    });
    res.setHeader("X-Total-Count", String(result.total));
    res.json(result.rows);
  },
);

router.get(
  "/spese-emporio/sessione/:sessioneCassaId",
  requirePermission("emporio.sales.view"),
  async (req, res) => {
    if (!(await assertEmporioEnabled(res))) return;
    const spesa = await getSpesaEmporioBySessione(
      Number(req.params.sessioneCassaId),
    );
    if (!(await ensureSpesaAccess(spesa, req, res))) return;
    res.json(spesa);
  },
);

router.get(
  "/spese-emporio/:id",
  requirePermission("emporio.sales.view"),
  async (req, res) => {
    if (!(await assertEmporioEnabled(res))) return;
    const spesa = await getSpesaEmporio(Number(req.params.id));
    if (!(await ensureSpesaAccess(spesa, req, res))) return;
    res.json(spesa);
  },
);

router.get(
  "/spese-emporio/:id/bolla-stampa",
  requirePermission("emporio.sales.view"),
  async (req, res) => {
    if (!(await assertEmporioEnabled(res))) return;
    const spesa = await getSpesaEmporio(Number(req.params.id));
    if (!(await ensureSpesaAccess(spesa, req, res))) return;
    const stampa = await getBollaStampaSpesaEmporio(Number(req.params.id));
    res.json(stampa);
  },
);

async function handleRegistraInvioManualeBolla(
  req: import("express").Request,
  res: import("express").Response,
): Promise<void> {
  if (!(await assertEmporioEnabled(res))) return;
  const spesa = await getSpesaEmporio(Number(req.params.id));
  if (!(await ensureSpesaAccess(spesa, req, res))) return;
  try {
    const result = await registraInvioManualeBollaEmporio({
      spesaId: Number(req.params.id),
      operatoreId: operatorId(req),
      linkBolla: buildBollaLink(req, Number(req.params.id)),
      ip: req.ip,
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

router.post(
  "/spese-emporio/:id/registra-invio-manuale-bolla",
  requirePermission("emporio.sales.manage"),
  handleRegistraInvioManualeBolla,
);
router.post(
  "/spese-emporio/:id/invia-bolla-email",
  requirePermission("emporio.sales.manage"),
  handleRegistraInvioManualeBolla,
);

router.post(
  "/spese-emporio/:id/storna",
  requirePermission("emporio.sales.reverse"),
  async (req, res) => {
    if (!(await assertEmporioEnabled(res))) return;
    const spesaId = Number(req.params.id);
    const spesa = await getSpesaEmporio(spesaId);
    if (!(await ensureSpesaAccess(spesa, req, res))) return;
    const motivo = asText(req.body?.motivo);
    if (!motivo) {
      res.status(400).json({ error: "Il motivo dello storno è obbligatorio." });
      return;
    }
    let righe: Array<{ spesaRigaId: number; quantita: string }> | undefined;
    if (req.body?.righe !== undefined) {
      if (!Array.isArray(req.body.righe) || req.body.righe.length === 0) {
        res.status(400).json({
          error:
            "Indicare almeno una riga da stornare oppure omettere righe per lo storno totale.",
        });
        return;
      }
      const righeRichieste = req.body.righe.map(
        (row: Record<string, unknown>) => ({
          spesaRigaId: Number(row.spesaRigaId),
          quantita: asPositiveQuantity(row.quantita),
        }),
      );
      if (
        righeRichieste.some(
          (row: { spesaRigaId: number; quantita: string | null }) =>
            !Number.isSafeInteger(row.spesaRigaId) ||
            row.spesaRigaId <= 0 ||
            row.quantita == null,
        )
      ) {
        res.status(400).json({ error: "Righe di storno non valide." });
        return;
      }
      righe = righeRichieste as Array<{
        spesaRigaId: number;
        quantita: string;
      }>;
    }
    try {
      const idempotencyKey = asText(
        req.get("idempotency-key") ?? req.body?.idempotencyKey,
      );
      if (idempotencyKey && idempotencyKey.length > 100) {
        res.status(400).json({
          error: "La chiave di idempotenza non può superare 100 caratteri.",
        });
        return;
      }
      const result = await stornaSpesaEmporio({
        spesaId,
        motivo,
        righe,
        operatoreId: operatorId(req),
        idempotencyKey,
        ip: req.ip,
      });
      res
        .status(201)
        .json({ ...result, spesa: await getSpesaEmporio(spesaId) });
    } catch (error) {
      if (error instanceof SpesaEmporioError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      throw error;
    }
  },
);

export default router;
