import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import type { Request } from "express";
import { loadSessionUser } from "../../middlewares/auth";
import { assertReportSectionAccess } from "./access";
import {
  assertReportFilterScope,
  parseReportFilters,
  ReportingError,
} from "./filters";
import { buildReportFilterOptions } from "./filterOptions";
import { buildDrilldown } from "./drilldown";
import { buildGeneralReport } from "./generale";
import { buildPacchiReport } from "./pacchi";
import { buildCentroAscoltoReport } from "./centroAscolto";
import { buildEmporioReport } from "./emporio";
import { buildMensaReport } from "./mensa";
import { buildUdsReport } from "./uds";
import { buildLogisticaReport } from "./logistica";
import { buildFsePlusReport } from "./fsePlus";
import { isReportModuleActive, withReportExecutor } from "./queryContext";
import type { ReportDrilldown, ReportSection } from "./types";

const builders = {
  generale: buildGeneralReport,
  pacchi: buildPacchiReport,
  "centro-ascolto": buildCentroAscoltoReport,
  emporio: buildEmporioReport,
  mensa: buildMensaReport,
  uds: buildUdsReport,
  "magazzino-logistica": buildLogisticaReport,
  "fse-plus": buildFsePlusReport,
};
const modules = [
  "REPORT",
  "MAGAZZINO_SOLIDALE",
  "BOLLE",
  "CENTRO_ASCOLTO",
  "EMPORIO_SOLIDALE",
  "MENSA",
  "UDS",
  "LOTTI",
  "TRASFERIMENTI",
  "MEZZI",
  "FORNITORI",
  "APPROVVIGIONAMENTI",
  "VOLONTARI",
];
const moduleState = () => Promise.all(modules.map(isReportModuleActive));

/** Read-only, bounded, one generation. No client-supplied accounting values. */
export async function prepareReport(req: Request) {
  const section = String(req.query.section ?? "") as ReportSection;
  if (!Object.hasOwn(builders, section))
    throw new ReportingError(400, "Sezione non valida");
  const language = String(req.query.language ?? "it");
  if (!["it", "en", "es", "fr", "de", "ar"].includes(language))
    throw new ReportingError(400, "Lingua non valida");
  const detailKind = req.query.detail ?? "none";
  if (
    detailKind !== "none" &&
    !(detailKind === "fse-control" && section === "fse-plus")
  )
    throw new ReportingError(400, "Dettaglio non supportato");
  const userId = req.session?.userId;
  if (!userId) throw new ReportingError(401, "Sessione richiesta");
  const user = await loadSessionUser(userId);
  if (!user) throw new ReportingError(403, "Accesso revocato");
  req.user = user;
  await assertReportSectionAccess(req, section);
  const filters = parseReportFilters(req);
  await assertReportFilterScope(req, filters);
  if (section === "mensa" && filters.callerMensaIds?.length === 0)
    throw new ReportingError(403, "Nessuna assegnazione Mensa attiva");
  const initialModules = await moduleState();
  const prepared = await db.transaction(
    async (tx) => {
      await tx.execute(sql`SET LOCAL statement_timeout = '30s'`);
      return withReportExecutor(tx, async () => {
        await assertReportSectionAccess(req, section);
        const snapshotModules = await moduleState();
        if (JSON.stringify(snapshotModules) !== JSON.stringify(initialModules))
          throw new ReportingError(
            409,
            "Configurazione cambiata: generare nuovamente il report",
          );
        const [report, options] = await Promise.all([
          builders[section](filters),
          buildReportFilterOptions(
            req,
            section,
            filters.areaOperativaId,
            filters,
          ),
        ]);
        let detail: ReportDrilldown | null = null;
        if (detailKind === "fse-control") {
          // The explicit detail is a ledger allowlist, never daily UDS notes or a dossier.
          detail = await buildDrilldown({
            section,
            metric: "prodottiFse",
            filters,
            page: 1,
            pageSize: 1000,
          });
          if (detail.total > 1000 || detail.rows.length !== detail.total)
            throw new ReportingError(
              413,
              "Dettaglio troppo ampio: restringere i filtri (massimo 1000 righe)",
            );
        }
        return {
          datasetId: randomUUID(),
          language,
          definitionRevision: "M66_BC_1",
          report,
          options,
          detail,
        };
      });
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );

  // Deliberately OUTSIDE the repeatable-read snapshot: a revoke/logout during
  // generation must not be hidden by the old snapshot or a populated browser cache.
  await new Promise<void>((resolve, reject) =>
    req.session.reload((error) => {
      if (error) {
        // Detach only this stale request. With rolling sessions, keeping the old
        // object would reissue its cookie over a concurrent user's new login.
        // Never destroy the current store session or clear the client's cookie.
        Reflect.deleteProperty(req, "session");
        reject(new ReportingError(401, "Sessione terminata"));
      } else resolve();
    }),
  );
  if (req.session.userId !== userId) {
    Reflect.deleteProperty(req, "session");
    throw new ReportingError(401, "Sessione cambiata");
  }
  const currentUser = await loadSessionUser(userId);
  if (!currentUser || JSON.stringify(currentUser) !== JSON.stringify(user))
    throw new ReportingError(
      403,
      "Autorizzazione cambiata durante la preparazione",
    );
  req.user = currentUser;
  await assertReportSectionAccess(req, section);
  const currentFilters = parseReportFilters(req);
  await assertReportFilterScope(req, currentFilters);
  if (
    JSON.stringify(currentFilters) !== JSON.stringify(filters) ||
    JSON.stringify(await moduleState()) !== JSON.stringify(initialModules)
  )
    throw new ReportingError(403, "Perimetro cambiato durante la preparazione");
  if (Buffer.byteLength(JSON.stringify(prepared), "utf8") > 8 * 1024 * 1024)
    throw new ReportingError(
      413,
      "Report troppo ampio: restringere i filtri (massimo 8 MiB)",
    );
  return prepared;
}
