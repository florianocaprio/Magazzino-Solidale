import { Router, type IRouter } from "express";
import { requireSuperAdmin } from "../middlewares/auth";
import {
  getConfigurazioneAmbiente,
  listAuditConfigurazioni,
  listModuliFunzionali,
  updateConfigurazioneAmbiente,
  updateModuloAmbiente,
} from "../lib/configurazioneAmbiente";
import { auditMetaFromRequest, logConfigurazioneAudit } from "../lib/auditConfigurazioni";

const router: IRouter = Router();

router.use("/super-admin", requireSuperAdmin);

const STRING_FIELDS = [
  "codiceAmbiente",
  "nomeAmbiente",
  "nomeAssociazione",
  "descrizione",
  "indirizzo",
  "comune",
  "provincia",
  "codiceFiscale",
  "partitaIva",
  "email",
  "telefono",
  "sitoWeb",
  "logoDocumentiUrl",
  "logoTessereUrl",
  "footerDocumenti",
  "noteLegali",
  "privacyTestoBreve",
] as const;

const REQUIRED_STRING_FIELDS = new Set([
  "codiceAmbiente",
  "nomeAmbiente",
  "nomeAssociazione",
]);

type ConfigUpdate = Parameters<typeof updateConfigurazioneAmbiente>[0];
type ConfigRouteUpdate = Partial<
  Record<(typeof STRING_FIELDS)[number], string | null> & { attivo: boolean }
>;

function parseConfigUpdate(body: unknown): { updates: ConfigRouteUpdate; error?: string } {
  if (body == null || typeof body !== "object" || Array.isArray(body)) {
    return { updates: {}, error: "Payload non valido" };
  }

  const source = body as Record<string, unknown>;
  const updates: ConfigRouteUpdate = {};

  for (const field of STRING_FIELDS) {
    if (!(field in source)) continue;
    const value = source[field];
    if (value === null || value === undefined) {
      if (REQUIRED_STRING_FIELDS.has(field)) {
        return { updates, error: `${field} non può essere vuoto` };
      }
      updates[field] = null;
      continue;
    }
    if (typeof value !== "string") {
      return { updates, error: `${field} deve essere una stringa` };
    }
    const normalized = value.trim();
    if (!normalized && REQUIRED_STRING_FIELDS.has(field)) {
      return { updates, error: `${field} non può essere vuoto` };
    }
    updates[field] = normalized || null;
  }

  if ("attivo" in source) {
    if (typeof source.attivo !== "boolean") {
      return { updates, error: "attivo deve essere booleano" };
    }
    updates.attivo = source.attivo;
  }

  return { updates };
}

function parseModuloUpdate(body: unknown): { attivo?: boolean; error?: string } {
  if (body == null || typeof body !== "object" || Array.isArray(body)) {
    return { error: "Payload non valido" };
  }
  const source = body as Record<string, unknown>;
  if (typeof source.attivo !== "boolean") {
    return { error: "attivo deve essere booleano" };
  }
  return { attivo: source.attivo };
}

router.get("/super-admin/configurazione-ambiente", async (_req, res) => {
  res.json(await getConfigurazioneAmbiente());
});

router.patch("/super-admin/configurazione-ambiente", async (req, res): Promise<void> => {
  const parsed = parseConfigUpdate(req.body);
  if (parsed.error) {
    res.status(400).json({ error: parsed.error });
    return;
  }

  const before = await getConfigurazioneAmbiente();
  const updates = {
    ...parsed.updates,
    aggiornatoDaId: req.user?.id ?? null,
  } as ConfigUpdate;
  const after = await updateConfigurazioneAmbiente(updates);

  await logConfigurazioneAudit({
    area: "configurazione_ambiente",
    chiave: "singleton",
    azione: "update",
    valorePrecedente: { ...before },
    valoreNuovo: { ...after },
    ...auditMetaFromRequest(req),
  });

  res.json(after);
});

router.get("/super-admin/moduli", async (_req, res) => {
  res.json(await listModuliFunzionali());
});

router.patch("/super-admin/moduli/:codice", async (req, res): Promise<void> => {
  const parsed = parseModuloUpdate(req.body);
  if (parsed.error) {
    res.status(400).json({ error: parsed.error });
    return;
  }

  const codice = String(req.params.codice ?? "");
  const before = (await listModuliFunzionali()).find(
    (m) => m.codice === codice.trim().toUpperCase(),
  );
  const result = await updateModuloAmbiente(
    codice,
    parsed.attivo!,
    req.user?.id ?? null,
  );
  if ("error" in result) {
    res.status(result.status).json({ error: result.error });
    return;
  }

  await logConfigurazioneAudit({
    area: "moduli_funzionali",
    chiave: result.codice,
    azione: "toggle",
    valorePrecedente: before ? { ...before } : null,
    valoreNuovo: { ...result },
    ...auditMetaFromRequest(req),
  });

  res.json(result);
});

router.get("/super-admin/audit-configurazioni", async (req, res) => {
  const limit = req.query.limit != null ? Number(req.query.limit) : 100;
  res.json(await listAuditConfigurazioni(limit));
});

export default router;
