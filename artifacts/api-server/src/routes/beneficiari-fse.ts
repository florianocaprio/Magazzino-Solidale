import { createHash, randomInt } from "node:crypto";
import express, { Router, type IRouter, type Request } from "express";
import { and, eq, inArray } from "drizzle-orm";
import {
  auditConfigurazioniTable,
  beneficiariTable,
  centriAscoltoTable,
  db,
  fseFascicoliSocialiTable,
  fseImportBatchesTable,
  nucleoFamiliareTable,
} from "@workspace/db";
import { requirePermission } from "../middlewares/auth";
import {
  canAccessAreaOperativa,
  canAccessCentro,
  callerAreaOperativaId,
  callerCentroId,
  callerZonaUdsId,
} from "../lib/centroScope";
import { canAccessBeneficiarioRecord } from "../lib/beneficiarioPolicy";
import { searchBeneficiariDuplicates } from "../lib/beneficiarioDuplicates";
import { dataCivileEuropeRome, isDateOnly } from "../lib/interventiWorkflow";
import {
  buildFseBeneficiariWorkbook,
  calcolaDemografiaNucleo,
  confrontaDemografia,
  FSE_BENEFICIARI_HEADERS,
  mapActiveToFseState,
  mapDeliveryToFseActivity,
  mapFseActivityToDelivery,
  normalizeFseCode,
  parseFseBeneficiariWorkbook,
  validateFseHeaders,
  validateFseRows,
  type DemografiaSnapshot,
  type FseBeneficiariRow,
} from "../lib/fseBeneficiari";

const router: IRouter = Router();
const FSE_WORKBOOK_MAX_BYTES = 10 * 1024 * 1024;
const multipartWorkbookBody = express.raw({
  type: "multipart/form-data",
  limit: FSE_WORKBOOK_MAX_BYTES,
});

type RawBody = {
  centroAscoltoId?: unknown;
  areaOperativaId?: unknown;
  nomeFile?: unknown;
  sha256File?: unknown;
  headers?: unknown;
  righe?: unknown;
  risoluzioni?: unknown;
  dataRiferimento?: unknown;
  soloAttivi?: unknown;
};

type MultipartWorkbook = {
  file: Buffer;
  nomeFile: string;
  fields: Record<string, string>;
};

type ImportResolution = {
  numeroRiga: number;
  azione: "crea" | "collega";
  beneficiarioId?: number;
};

class RowImportError extends Error {
  constructor(readonly codice: string, message: string) {
    super(message);
  }
}

function parseMultipartWorkbook(req: Request):
  | { ok: true; upload: MultipartWorkbook }
  | { ok: false; status: 400 | 415; error: string } {
  const contentType = req.get("content-type") ?? "";
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
  if (!contentType.toLowerCase().startsWith("multipart/form-data") || !boundaryMatch) {
    return { ok: false, status: 415, error: "È richiesto multipart/form-data con un workbook XLSX." };
  }
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
    return { ok: false, status: 400, error: "Workbook FSE+ mancante." };
  }
  const multipartBody: Buffer = req.body;
  const boundary = boundaryMatch[1] ?? boundaryMatch[2];
  if (!boundary || boundary.length > 200) {
    return { ok: false, status: 400, error: "Boundary multipart non valido." };
  }
  const marker = Buffer.from(`--${boundary}`);
  const separator = Buffer.from("\r\n\r\n");
  const nextMarker = Buffer.from(`\r\n--${boundary}`);
  const fields: Record<string, string> = {};
  let file: Buffer | null = null;
  let nomeFile = "";
  let cursor = multipartBody.indexOf(marker);
  try {
    while (cursor >= 0) {
      cursor += marker.length;
      if (multipartBody.subarray(cursor, cursor + 2).toString() === "--") break;
      if (multipartBody.subarray(cursor, cursor + 2).toString() !== "\r\n") throw new Error();
      cursor += 2;
      const headerEnd = multipartBody.indexOf(separator, cursor);
      if (headerEnd < 0) throw new Error();
      const headers = multipartBody.subarray(cursor, headerEnd).toString("utf8");
      const disposition = headers.split("\r\n").find((line) =>
        line.toLowerCase().startsWith("content-disposition:"));
      const name = disposition ? /\bname="([^"]+)"/i.exec(disposition)?.[1] : null;
      const filename = disposition ? /\bfilename="([^"]*)"/i.exec(disposition)?.[1] : null;
      if (!name) throw new Error();
      const dataStart = headerEnd + separator.length;
      const dataEnd = multipartBody.indexOf(nextMarker, dataStart);
      if (dataEnd < 0) throw new Error();
      const data = multipartBody.subarray(dataStart, dataEnd);
      if (filename != null) {
        if (name !== "file" || file) throw new Error();
        file = Buffer.from(data);
        nomeFile = filename.replace(/[^\p{L}\p{N}._ -]/gu, "_").slice(0, 255);
      } else {
        if (!["centroAscoltoId", "risoluzioni"].includes(name) || name in fields) throw new Error();
        fields[name] = data.toString("utf8");
      }
      cursor = dataEnd + 2;
    }
  } catch {
    return { ok: false, status: 400, error: "Payload multipart FSE+ non valido." };
  }
  if (!file || !nomeFile.toLowerCase().endsWith(".xlsx")) {
    return { ok: false, status: 400, error: "È richiesto un unico file .xlsx nel campo file." };
  }
  return { ok: true, upload: { file, nomeFile, fields } };
}

function authoritativeWorkbookBody(upload: MultipartWorkbook):
  | { ok: true; body: RawBody }
  | { ok: false; status: 400; error: string; errori?: string[]; warning?: string[] } {
  let parsed: ReturnType<typeof parseFseBeneficiariWorkbook>;
  try {
    parsed = parseFseBeneficiariWorkbook(upload.file);
  } catch {
    return { ok: false, status: 400, error: "Workbook XLSX non leggibile." };
  }
  if (parsed.header.errori.length) {
    return {
      ok: false,
      status: 400,
      error: "Workbook FSE+ non conforme.",
      errori: parsed.header.errori,
      warning: parsed.header.warning,
    };
  }
  let risoluzioni: unknown;
  if (upload.fields.risoluzioni != null) {
    try {
      risoluzioni = JSON.parse(upload.fields.risoluzioni);
    } catch {
      return { ok: false, status: 400, error: "Le risoluzioni import non sono JSON valido." };
    }
  }
  return {
    ok: true,
    body: {
      centroAscoltoId: upload.fields.centroAscoltoId,
      nomeFile: upload.nomeFile,
      sha256File: createHash("sha256").update(upload.file).digest("hex"),
      headers: parsed.headers,
      righe: parsed.rawRows,
      risoluzioni,
    },
  };
}

async function selectedCentro(body: RawBody, req: Request) {
  if (callerZonaUdsId(req) != null) {
    return {
      ok: false,
      error: "L'import/export FSE+ opera sull'intero Centro e non è disponibile per un profilo limitato a una Zona UDS.",
      status: 403,
    } as const;
  }
  const id = Number(body.centroAscoltoId);
  if (!Number.isSafeInteger(id) || id <= 0) {
    return { ok: false, error: "Seleziona un Centro di Ascolto valido.", status: 400 } as const;
  }
  const [centro] = await db.select().from(centriAscoltoTable).where(eq(centriAscoltoTable.id, id));
  if (!centro || !centro.attivo || centro.areaOperativaId == null) {
    return {
      ok: false,
      error: "Il Centro selezionato non è attivo o non ha un'Area Operativa valida.",
      status: 400,
    } as const;
  }
  if (
    !canAccessCentro(centro.id, callerCentroId(req)) ||
    !canAccessAreaOperativa(centro.areaOperativaId, callerAreaOperativaId(req))
  ) {
    return { ok: false, error: "Centro di Ascolto non accessibile.", status: 403 } as const;
  }
  return { ok: true, centro: { ...centro, areaOperativaId: centro.areaOperativaId } } as const;
}

function rawRows(body: RawBody): Array<Record<string, unknown>> | null {
  return Array.isArray(body.righe) &&
    body.righe.length >= 1 &&
    body.righe.length <= 500 &&
    body.righe.every((row) => row && typeof row === "object" && !Array.isArray(row))
    ? body.righe as Array<Record<string, unknown>>
    : null;
}

function validatedHeaders(body: RawBody) {
  return validateFseHeaders(Array.isArray(body.headers) ? body.headers : []);
}

function fileMetadata(body: RawBody): { nomeFile: string; sha256File: string } | null {
  const nomeFile = String(body.nomeFile ?? "").trim();
  const sha256File = String(body.sha256File ?? "").trim().toLowerCase();
  if (!nomeFile || nomeFile.length > 255 || !/^[a-f0-9]{64}$/.test(sha256File)) return null;
  return { nomeFile, sha256File };
}

function normalizedRowsHash(rows: FseBeneficiariRow[]): string {
  return createHash("sha256").update(JSON.stringify(rows.map(({ hash }) => hash))).digest("hex");
}

function parseResolutions(value: unknown): { map: Map<number, ImportResolution>; error?: string } {
  if (value == null) return { map: new Map() };
  if (!Array.isArray(value)) return { map: new Map(), error: "Le risoluzioni import non sono valide." };
  const map = new Map<number, ImportResolution>();
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return { map: new Map(), error: "Risoluzione import non valida." };
    }
    const raw = item as Record<string, unknown>;
    const numeroRiga = Number(raw.numeroRiga);
    const azione = raw.azione;
    const beneficiarioId = raw.beneficiarioId == null ? undefined : Number(raw.beneficiarioId);
    if (
      !Number.isSafeInteger(numeroRiga) ||
      numeroRiga < 2 ||
      (azione !== "crea" && azione !== "collega") ||
      (azione === "collega" && (!Number.isSafeInteger(beneficiarioId) || beneficiarioId! <= 0)) ||
      map.has(numeroRiga)
    ) {
      return { map: new Map(), error: "Risoluzione import non valida o duplicata." };
    }
    map.set(numeroRiga, { numeroRiga, azione, beneficiarioId });
  }
  return { map };
}

async function uniqueBeneficiarioCode() {
  for (let attempt = 0; attempt < 100; attempt++) {
    const codice = `BEN-${String(randomInt(0, 10_000_000_000_000)).padStart(13, "0")}`;
    const [hit] = await db.select({ id: beneficiariTable.id })
      .from(beneficiariTable)
      .where(eq(beneficiariTable.codice, codice));
    if (!hit) return codice;
  }
  throw new Error("Impossibile generare un codice beneficiario univoco");
}

function snapshotValues(row: FseBeneficiariRow, batchId: number) {
  return {
    codiceFascicolo: row.codiceFascicolo,
    codiceFascicoloNormalizzato: normalizeFseCode(row.codiceFascicolo),
    origineFascicolo: "import_fse",
    numeroComponentiImportato: row.numeroComponenti,
    donneImportate: row.donne,
    uominiImportati: row.uomini,
    eta017Importata: row.eta017,
    eta1829Importata: row.eta1829,
    eta3064Importata: row.eta3064,
    eta65PlusImportata: row.eta65Plus,
    origineStranieraMinoranze: row.origineStranieraMinoranze,
    cittadiniPaesiTerzi: row.cittadiniPaesiTerzi,
    senzaTettoEsclusioneAbitativa: row.senzaTettoEsclusioneAbitativa,
    tipologiaAttivitaImportata: row.tipologiaAttivita,
    statoAttualeImportato: row.statoAttuale,
    ultimoImportBatchId: batchId,
    ultimoImportAt: new Date(),
    hashUltimaRigaImportata: row.hash,
    dataAggiornamento: new Date(),
  };
}

function snapshotFromProfile(
  profile: typeof fseFascicoliSocialiTable.$inferSelect | null | undefined,
): DemografiaSnapshot | null {
  if (
    profile?.numeroComponentiImportato == null ||
    profile.donneImportate == null ||
    profile.uominiImportati == null ||
    profile.eta017Importata == null ||
    profile.eta1829Importata == null ||
    profile.eta3064Importata == null ||
    profile.eta65PlusImportata == null
  ) return null;
  return {
    numeroComponenti: profile.numeroComponentiImportato,
    donne: profile.donneImportate,
    uomini: profile.uominiImportati,
    eta017: profile.eta017Importata,
    eta1829: profile.eta1829Importata,
    eta3064: profile.eta3064Importata,
    eta65Plus: profile.eta65PlusImportata,
  };
}

function samePersonName(
  beneficiary: Pick<typeof beneficiariTable.$inferSelect, "nome" | "cognome">,
  row: FseBeneficiariRow,
) {
  return beneficiary.nome.trim().toLocaleLowerCase("it-IT") === row.nome.toLocaleLowerCase("it-IT") &&
    beneficiary.cognome.trim().toLocaleLowerCase("it-IT") === row.cognome.toLocaleLowerCase("it-IT");
}

function previewItem(item: ReturnType<typeof validateFseRows>[number]) {
  return {
    numeroRiga: item.numeroRiga,
    codiceFascicolo: item.codiceFascicolo,
    errori: item.errori,
    warning: item.warning,
  };
}

router.post(
  "/beneficiari/fse/preview",
  requirePermission("beneficiari.fse.import"),
  multipartWorkbookBody,
  async (req, res) => {
    const multipart = parseMultipartWorkbook(req);
    if (!multipart.ok) { res.status(multipart.status).json({ error: multipart.error }); return; }
    const authoritative = authoritativeWorkbookBody(multipart.upload);
    if (!authoritative.ok) {
      res.status(authoritative.status).json({
        error: authoritative.error,
        errori: authoritative.errori,
        warning: authoritative.warning,
      });
      return;
    }
    const body = authoritative.body;
    const scoped = await selectedCentro(body, req);
    if (!scoped.ok) { res.status(scoped.status).json({ error: scoped.error }); return; }
    const righe = rawRows(body);
    if (!righe) { res.status(400).json({ error: "Il file deve contenere da 1 a 500 righe." }); return; }
    const headerResult = validatedHeaders(body);
    if (headerResult.errori.length) {
      res.status(400).json({ error: "Header FSE+ non valido.", ...headerResult });
      return;
    }
    const validated = validateFseRows(righe);
    const result: Array<Record<string, unknown>> = [];
    for (const item of validated) {
      if (!item.row) {
        result.push({ ...previewItem(item), classificazione: "errore" });
        continue;
      }
      const [fascicolo] = await db
        .select({ profilo: fseFascicoliSocialiTable, beneficiario: beneficiariTable })
        .from(fseFascicoliSocialiTable)
        .innerJoin(beneficiariTable, eq(beneficiariTable.id, fseFascicoliSocialiTable.beneficiarioId))
        .where(eq(
          fseFascicoliSocialiTable.codiceFascicoloNormalizzato,
          normalizeFseCode(item.row.codiceFascicolo)!,
        ));
      if (fascicolo) {
        const territorial =
          fascicolo.beneficiario.centroAscoltoId === scoped.centro.id &&
          fascicolo.beneficiario.areaOperativaId === scoped.centro.areaOperativaId;
        const warning = [...item.warning];
        if (!samePersonName(fascicolo.beneficiario, item.row)) {
          warning.push("Nome/cognome differiscono dall'anagrafica collegata.");
        }
        if (
          fascicolo.beneficiario.dataPresaInCarico &&
          fascicolo.beneficiario.dataPresaInCarico !== item.row.dataPresaInCarico
        ) {
          warning.push("La data di presa in carico interna è differente e non verrà sovrascritta.");
        }
        const classificazione = !territorial || !samePersonName(fascicolo.beneficiario, item.row)
          ? "conflitto"
          : fascicolo.profilo.hashUltimaRigaImportata === item.row.hash
            ? "invariato"
            : "da_aggiornare";
        result.push({
          ...previewItem(item),
          warning,
          classificazione,
          beneficiarioId: fascicolo.beneficiario.id,
        });
        continue;
      }

      const suggestions = await searchBeneficiariDuplicates({
        areaOperativaId: scoped.centro.areaOperativaId,
        nome: item.row.nome,
        cognome: item.row.cognome,
      });
      const accessible = suggestions.filter((candidate) => candidate.centroAscoltoId === scoped.centro.id);
      const hasRemoteSimilarity = suggestions.length > accessible.length;
      result.push({
        ...previewItem(item),
        classificazione: suggestions.length ? "possibile_duplicato" : "nuovo",
        duplicati: accessible.map((candidate) => ({
          id: candidate.id,
          codice: candidate.codice,
          centroAscoltoId: candidate.centroAscoltoId,
        })),
        warning: hasRemoteSimilarity
          ? [...item.warning, "È stata rilevata una somiglianza nominativa fuori dal Centro; i dati personali non sono esposti. Scegli esplicitamente Crea nuovo per procedere."]
          : item.warning,
      });
    }
    const conteggi = result.reduce<Record<string, number>>((accumulator, row) => {
      const key = String(row.classificazione);
      accumulator[key] = (accumulator[key] ?? 0) + 1;
      return accumulator;
    }, {});
    const metadata = fileMetadata(body);
    if (metadata) {
      await db.insert(auditConfigurazioniTable).values({
        area: "beneficiari",
        chiave: `fse-preview:${metadata.sha256File.slice(0, 16)}`,
        azione: "preview-import-fse",
        valoreNuovo: {
          centroAscoltoId: scoped.centro.id,
          areaOperativaId: scoped.centro.areaOperativaId,
          numeroRighe: righe.length,
          sha256File: metadata.sha256File,
          conteggi,
        },
        utenteId: req.user?.id ?? null,
        ip: req.ip ?? req.socket.remoteAddress ?? null,
      });
    }
    res.json({
      centroAscoltoId: scoped.centro.id,
      areaOperativaId: scoped.centro.areaOperativaId,
      areaOperativaDerivata: true,
      warningHeader: headerResult.warning,
      righe: result,
      conteggi,
      numeroRighe: righe.length,
    });
  },
);

router.post(
  "/beneficiari/fse/import",
  requirePermission("beneficiari.fse.import"),
  multipartWorkbookBody,
  async (req, res) => {
    const multipart = parseMultipartWorkbook(req);
    if (!multipart.ok) { res.status(multipart.status).json({ error: multipart.error }); return; }
    const authoritative = authoritativeWorkbookBody(multipart.upload);
    if (!authoritative.ok) {
      res.status(authoritative.status).json({
        error: authoritative.error,
        errori: authoritative.errori,
        warning: authoritative.warning,
      });
      return;
    }
    const body = authoritative.body;
    const scoped = await selectedCentro(body, req);
    if (!scoped.ok) { res.status(scoped.status).json({ error: scoped.error }); return; }
    const righe = rawRows(body);
    if (!righe) { res.status(400).json({ error: "Righe FSE+ non valide." }); return; }
    const headerResult = validatedHeaders(body);
    if (headerResult.errori.length) {
      res.status(400).json({ error: "Header FSE+ non valido.", ...headerResult });
      return;
    }
    const metadata = fileMetadata(body);
    if (!metadata) {
      res.status(400).json({ error: "Nome file o SHA-256 del workbook non validi." });
      return;
    }
    const parsedResolutions = parseResolutions(body.risoluzioni);
    if (parsedResolutions.error) {
      res.status(400).json({ error: parsedResolutions.error });
      return;
    }

    const validations = validateFseRows(righe);
    const validRows = validations.flatMap((item) => item.row ? [item.row] : []);
    const contentHash = normalizedRowsHash(validRows);
    const [batch] = await db.insert(fseImportBatchesTable).values({
      nomeFile: metadata.nomeFile,
      sha256File: metadata.sha256File,
      hashContenutoNormalizzato: contentHash,
      centroAscoltoId: scoped.centro.id,
      areaOperativaId: scoped.centro.areaOperativaId,
      utenteId: req.user?.id ?? null,
      numeroRighe: righe.length,
    }).returning();
    await db.insert(auditConfigurazioniTable).values({
      area: "beneficiari",
      chiave: `fse-import:${batch.id}`,
      azione: "import-fse-avviato",
      valoreNuovo: {
        batchId: batch.id,
        centroAscoltoId: scoped.centro.id,
        areaOperativaId: scoped.centro.areaOperativaId,
        numeroRighe: righe.length,
        sha256File: metadata.sha256File,
        hashContenutoNormalizzato: contentHash,
      },
      utenteId: req.user?.id ?? null,
      ip: req.ip ?? req.socket.remoteAddress ?? null,
    });

    const totals = {
      creati: 0,
      collegati: 0,
      aggiornati: 0,
      invariati: 0,
      conflitti: 0,
      errori: 0,
    };
    const dettagli: Array<{
      numeroRiga: number;
      codiceFascicolo: string | null;
      esito: string;
      errori: string[];
    }> = [];

    for (const item of validations) {
      if (!item.row) {
        totals.errori++;
        dettagli.push({
          numeroRiga: item.numeroRiga,
          codiceFascicolo: item.codiceFascicolo,
          esito: "errore",
          errori: item.errori,
        });
        continue;
      }
      const row = item.row;
      try {
        const esito = await db.transaction(async (tx) => {
          const mergeConservativo = async (
            target: typeof beneficiariTable.$inferSelect,
          ) => {
            const nucleo = await tx.select().from(nucleoFamiliareTable)
              .where(eq(nucleoFamiliareTable.beneficiarioId, target.id));
            const demografiaInterna = calcolaDemografiaNucleo(
              target,
              nucleo,
              new Date(),
              null,
            );
            const nucleoInternoAutorevole = demografiaInterna.dettaglioCompleto &&
              (row.numeroComponenti <= 1 || nucleo.length > 0);
            const changes: Partial<typeof beneficiariTable.$inferInsert> = {
              numDisabili: row.disabili,
              dataAggiornamento: new Date(),
            };
            if (!target.dataPresaInCarico) changes.dataPresaInCarico = row.dataPresaInCarico;
            if (!nucleoInternoAutorevole) {
              changes.numComponenti = row.numeroComponenti;
              changes.numMinori = row.eta017;
              changes.numAnziani = row.eta65Plus;
            }
            // Il canale interno è considerato non autorevole solo per una
            // anagrafica provvisoria che non possiede una motivazione manuale.
            if (target.statoAnagrafica === "provvisoria" && !target.motivoConsegnaDomicilio) {
              changes.consegnaDomicilio = mapFseActivityToDelivery(row.tipologiaAttivita)!;
            }
            await tx.update(beneficiariTable).set(changes)
              .where(eq(beneficiariTable.id, target.id));
            return Object.keys(changes).filter((key) => key !== "dataAggiornamento");
          };

          const [existing] = await tx
            .select({ profilo: fseFascicoliSocialiTable, beneficiario: beneficiariTable })
            .from(fseFascicoliSocialiTable)
            .innerJoin(beneficiariTable, eq(beneficiariTable.id, fseFascicoliSocialiTable.beneficiarioId))
            .where(eq(
              fseFascicoliSocialiTable.codiceFascicoloNormalizzato,
              normalizeFseCode(row.codiceFascicolo)!,
            ));
          if (existing) {
            if (
              existing.beneficiario.centroAscoltoId !== scoped.centro.id ||
              existing.beneficiario.areaOperativaId !== scoped.centro.areaOperativaId ||
              !samePersonName(existing.beneficiario, row)
            ) return "conflitto" as const;
            if (existing.profilo.hashUltimaRigaImportata === row.hash) return "invariato" as const;

            await tx.update(fseFascicoliSocialiTable)
              .set(snapshotValues(row, batch.id))
              .where(eq(fseFascicoliSocialiTable.id, existing.profilo.id));
            const campiModificati = await mergeConservativo(existing.beneficiario);
            await tx.insert(auditConfigurazioniTable).values({
              area: "beneficiari",
              chiave: `beneficiario:${existing.beneficiario.id}:fse`,
              azione: "aggiornamento-fascicolo-fse",
              valoreNuovo: {
                batchId: batch.id,
                beneficiarioId: existing.beneficiario.id,
                hashRiga: row.hash,
                campiModificati,
              },
              utenteId: req.user?.id ?? null,
              ip: req.ip ?? req.socket.remoteAddress ?? null,
            });
            return "aggiornato" as const;
          }

          const suggestions = await searchBeneficiariDuplicates({
            areaOperativaId: scoped.centro.areaOperativaId,
            nome: row.nome,
            cognome: row.cognome,
          });
          const accessibleSuggestions = suggestions.filter(
            (candidate) => candidate.centroAscoltoId === scoped.centro.id,
          );
          const resolution = parsedResolutions.map.get(item.numeroRiga);
          if (suggestions.length && !resolution) {
            throw new RowImportError("DUPLICATO_NON_RISOLTO", "Possibile duplicato non risolto.");
          }

          let beneficiarioId: number;
          let outcome: "creato" | "collegato";
          if (resolution?.azione === "collega") {
            if (!accessibleSuggestions.some((candidate) => candidate.id === resolution.beneficiarioId)) {
              throw new RowImportError(
                "TARGET_NON_CANDIDATO",
                "Il beneficiario indicato non appartiene ai candidati consentiti.",
              );
            }
            const [target] = await tx.select().from(beneficiariTable)
              .where(eq(beneficiariTable.id, Number(resolution.beneficiarioId)));
            if (
              !target ||
              target.centroAscoltoId !== scoped.centro.id ||
              target.areaOperativaId !== scoped.centro.areaOperativaId
            ) {
              throw new RowImportError(
                "TARGET_NON_ACCESSIBILE",
                "Beneficiario da collegare non accessibile nel Centro selezionato.",
              );
            }
            const [targetProfile] = await tx.select({ id: fseFascicoliSocialiTable.id })
              .from(fseFascicoliSocialiTable)
              .where(eq(fseFascicoliSocialiTable.beneficiarioId, target.id));
            if (targetProfile) {
              throw new RowImportError("TARGET_GIA_COLLEGATO", "Il beneficiario possiede già un fascicolo FSE+.");
            }
            beneficiarioId = target.id;
            outcome = "collegato";
            const campiModificati = await mergeConservativo(target);
            await tx.insert(auditConfigurazioniTable).values({
              area: "beneficiari",
              chiave: `beneficiario:${target.id}:fse`,
              azione: "collegamento-fascicolo-fse",
              valoreNuovo: {
                batchId: batch.id,
                beneficiarioId: target.id,
                hashRiga: row.hash,
                campiModificati,
              },
              utenteId: req.user?.id ?? null,
              ip: req.ip ?? req.socket.remoteAddress ?? null,
            });
          } else {
            const mono = row.numeroComponenti === 1;
            const [created] = await tx.insert(beneficiariTable).values({
              codice: await uniqueBeneficiarioCode(),
              nome: row.nome,
              cognome: row.cognome,
              statoAnagrafica: "provvisoria",
              dataPresaInCarico: row.dataPresaInCarico,
              numComponenti: row.numeroComponenti,
              numMinori: row.eta017,
              numAnziani: row.eta65Plus,
              numDisabili: row.disabili,
              consegnaDomicilio: mapFseActivityToDelivery(row.tipologiaAttivita)!,
              attivo: true,
              centroAscoltoId: scoped.centro.id,
              areaOperativaId: scoped.centro.areaOperativaId,
              sesso: mono ? (row.donne === 1 ? "F" : "M") : null,
              fasciaEtaPresunta: mono
                ? row.eta017 === 1
                  ? "0_17"
                  : row.eta1829 === 1
                    ? "18_29"
                    : row.eta3064 === 1
                      ? "30_64"
                      : "65_plus"
                : null,
            }).returning({ id: beneficiariTable.id });
            beneficiarioId = created.id;
            outcome = "creato";
            if (suggestions.length && resolution?.azione === "crea") {
              await tx.insert(auditConfigurazioniTable).values({
                area: "beneficiari",
                chiave: `beneficiario:${created.id}:fse`,
                azione: "scelta-crea-nuovo-fse",
                valoreNuovo: {
                  batchId: batch.id,
                  beneficiarioId: created.id,
                  numeroCandidatiLocali: accessibleSuggestions.length,
                  presentiSomiglianzeFuoriCentro: suggestions.length > accessibleSuggestions.length,
                },
                utenteId: req.user?.id ?? null,
                ip: req.ip ?? req.socket.remoteAddress ?? null,
              });
            }
          }
          await tx.insert(fseFascicoliSocialiTable).values({
            beneficiarioId,
            ...snapshotValues(row, batch.id),
          });
          return outcome;
        });

        if (esito === "creato") totals.creati++;
        else if (esito === "collegato") totals.collegati++;
        else if (esito === "aggiornato") totals.aggiornati++;
        else if (esito === "invariato") totals.invariati++;
        else totals.conflitti++;
        dettagli.push({
          numeroRiga: item.numeroRiga,
          codiceFascicolo: item.codiceFascicolo,
          esito,
          errori: [],
        });
      } catch (error) {
        const safeError = error instanceof RowImportError
          ? error.codice
          : (error as { code?: string })?.code === "23505"
            ? "CODICE_FASCICOLO_GIA_ASSOCIATO"
            : "ERRORE_IMPORT_RIGA";
        if (safeError === "CONFLITTO_TERRITORIALE") totals.conflitti++;
        else totals.errori++;
        dettagli.push({
          numeroRiga: item.numeroRiga,
          codiceFascicolo: item.codiceFascicolo,
          esito: safeError === "CONFLITTO_TERRITORIALE" ? "conflitto" : "errore",
          errori: [safeError],
        });
      }
    }

    const stato = totals.errori || totals.conflitti ? "parziale" : "confermato";
    await db.update(fseImportBatchesTable)
      .set({ ...totals, stato, dataAggiornamento: new Date() })
      .where(eq(fseImportBatchesTable.id, batch.id));
    await db.insert(auditConfigurazioniTable).values({
      area: "beneficiari",
      chiave: `fse-import:${batch.id}`,
      azione: "import-fse-confermato",
      valoreNuovo: {
        batchId: batch.id,
        centroAscoltoId: scoped.centro.id,
        areaOperativaId: scoped.centro.areaOperativaId,
        numeroRighe: righe.length,
        sha256File: metadata.sha256File,
        hashContenutoNormalizzato: contentHash,
        ...totals,
      },
      utenteId: req.user?.id ?? null,
      ip: req.ip ?? req.socket.remoteAddress ?? null,
    });
    res.json({ batchId: batch.id, stato, ...totals, dettagli });
  },
);

async function exportCandidates(body: RawBody, req: Request) {
  const scoped = await selectedCentro(body, req);
  if (!scoped.ok) return scoped;
  if (body.soloAttivi === false) {
    return {
      ok: false,
      error: "Il tracciato attuale supporta esclusivamente beneficiari attivi.",
      status: 400,
    } as const;
  }
  const dateRaw = String(body.dataRiferimento ?? "");
  if (!isDateOnly(dateRaw)) {
    return { ok: false, error: "Data di riferimento non valida.", status: 400 } as const;
  }
  const reference = new Date(`${dateRaw}T12:00:00Z`);
  const beneficiaries = await db.select().from(beneficiariTable).where(and(
    eq(beneficiariTable.centroAscoltoId, scoped.centro.id),
    eq(beneficiariTable.areaOperativaId, scoped.centro.areaOperativaId),
    eq(beneficiariTable.attivo, true),
  ));
  const ids = beneficiaries.map((beneficiary) => beneficiary.id);
  const profiles = ids.length
    ? await db.select().from(fseFascicoliSocialiTable)
      .where(inArray(fseFascicoliSocialiTable.beneficiarioId, ids))
    : [];
  const members = ids.length
    ? await db.select().from(nucleoFamiliareTable)
      .where(inArray(nucleoFamiliareTable.beneficiarioId, ids))
    : [];
  const profileMap = new Map(profiles.map((profile) => [profile.beneficiarioId, profile]));
  const candidateCodes = beneficiaries.map((beneficiary) =>
    normalizeFseCode(profileMap.get(beneficiary.id)?.codiceFascicolo ?? beneficiary.codice)!);
  const codeOwners = candidateCodes.length
    ? await db.select({
      beneficiarioId: fseFascicoliSocialiTable.beneficiarioId,
      codice: fseFascicoliSocialiTable.codiceFascicoloNormalizzato,
    }).from(fseFascicoliSocialiTable)
      .where(inArray(fseFascicoliSocialiTable.codiceFascicoloNormalizzato, candidateCodes))
    : [];

  const rows = beneficiaries.map((beneficiary) => {
    const profile = profileMap.get(beneficiary.id);
    const snapshot = snapshotFromProfile(profile);
    const demografia = calcolaDemografiaNucleo(
      beneficiary,
      members.filter((member) => member.beneficiarioId === beneficiary.id),
      reference,
      snapshot,
    );
    const errori = [...demografia.problemi.filter(
      (problem) => !snapshot || demografia.origine === "anagrafica_calcolata" || problem.startsWith("SNAPSHOT_"),
    )];
    const warning: string[] = [];
    if (demografia.origine === "snapshot_fse") {
      warning.push("DEMOGRAFIA_DA_SNAPSHOT_FSE");
      if (!profile?.ultimoImportAt || dataCivileEuropeRome(profile.ultimoImportAt) !== dateRaw) {
        errori.push("SNAPSHOT_DATA_RIFERIMENTO_NON_COMPATIBILE");
      }
    }
    if (!beneficiary.nome.trim()) errori.push("NOME_MANCANTE");
    if (!beneficiary.cognome.trim()) errori.push("COGNOME_MANCANTE");
    if (!beneficiary.dataPresaInCarico) errori.push("DATA_PRESA_IN_CARICO_MANCANTE");
    if (!mapActiveToFseState(beneficiary.attivo)) errori.push("STATO_NON_MAPPABILE");
    if (
      profile?.tipologiaAttivitaImportata &&
      mapFseActivityToDelivery(profile.tipologiaAttivitaImportata) == null
    ) errori.push("ATTIVITA_NON_MAPPABILE");
    if (profile?.statoAttualeImportato && profile.statoAttualeImportato !== "Attivo") {
      errori.push("STATO_ESTERNO_NON_MAPPABILE");
    }
    if (demografia.numeroComponenti <= 0) errori.push("NUMERO_COMPONENTI_NON_VALIDO");
    if (demografia.donne + demografia.uomini !== demografia.numeroComponenti) {
      errori.push("SESSO_NON_ALLINEATO");
    }
    if (
      demografia.eta017 +
      demografia.eta1829 +
      demografia.eta3064 +
      demografia.eta65Plus !== demografia.numeroComponenti
    ) errori.push("FASCE_NON_ALLINEATE");
    if (beneficiary.numDisabili < 0 || beneficiary.numDisabili > demografia.numeroComponenti) {
      errori.push("DISABILI_NON_VALIDI");
    }
    for (const [value, missingCode] of [
      [profile?.origineStranieraMinoranze, "ORIGINE_STRANIERA_MINORANZE_NON_VALORIZZATA"],
      [profile?.cittadiniPaesiTerzi, "CITTADINI_PAESI_TERZI_NON_VALORIZZATO"],
      [profile?.senzaTettoEsclusioneAbitativa, "ESCLUSIONE_ABITATIVA_NON_VALORIZZATA"],
    ] as const) {
      if (value == null) errori.push(missingCode);
      else if (value < 0 || value > demografia.numeroComponenti) errori.push("CONTEGGIO_FSE_NON_VALIDO");
    }
    const code = profile?.codiceFascicolo ?? beneficiary.codice;
    if (!normalizeFseCode(code)) errori.push("CODICE_FASCICOLO_MANCANTE");
    if (codeOwners.some((owner) =>
      owner.codice === normalizeFseCode(code) && owner.beneficiarioId !== beneficiary.id)) {
      errori.push("CODICE_FASCICOLO_GIA_ASSOCIATO");
    }
    return {
      beneficiario: beneficiary,
      profilo: profile,
      demografia,
      code,
      errori: [...new Set(errori)],
      warning: [...new Set(warning)],
    };
  });
  return { ok: true, scoped, dateRaw, rows } as const;
}

router.post(
  "/beneficiari/fse/export/preflight",
  requirePermission("beneficiari.fse.export"),
  async (req, res) => {
    const result = await exportCandidates(req.body as RawBody, req);
    if (!result.ok) { res.status(result.status).json({ error: result.error }); return; }
    res.json({
      candidati: result.rows.length,
      esportabili: result.rows.filter((row) => !row.errori.length).length,
      bloccati: result.rows.filter((row) => row.errori.length).map((row) => ({
        beneficiarioId: row.beneficiario.id,
        codice: row.beneficiario.codice,
        errori: row.errori,
      })),
      warning: result.rows.filter((row) => row.warning.length).map((row) => ({
        beneficiarioId: row.beneficiario.id,
        codice: row.beneficiario.codice,
        warning: row.warning,
      })),
      centroAscoltoId: result.scoped.centro.id,
      areaOperativaId: result.scoped.centro.areaOperativaId,
      dataRiferimento: result.dateRaw,
      soloAttivi: true,
    });
  },
);

router.post(
  "/beneficiari/fse/export",
  requirePermission("beneficiari.fse.export"),
  async (req, res) => {
    const result = await exportCandidates(req.body as RawBody, req);
    if (!result.ok) { res.status(result.status).json({ error: result.error }); return; }
    if (!result.rows.length) {
      res.status(422).json({ error: "Nessun beneficiario attivo da esportare." });
      return;
    }
    const blocked = result.rows.filter((row) => row.errori.length);
    if (blocked.length) {
      res.status(422).json({
        error: "Preflight FSE+ non superato.",
        bloccati: blocked.map((row) => ({
          beneficiarioId: row.beneficiario.id,
          errori: row.errori,
        })),
      });
      return;
    }

    const outputRows = result.rows.map((item) => {
      const demographics = item.demografia;
      const profile = item.profilo;
      return {
        [FSE_BENEFICIARI_HEADERS[0]]: item.beneficiario.nome,
        [FSE_BENEFICIARI_HEADERS[1]]: item.beneficiario.cognome,
        [FSE_BENEFICIARI_HEADERS[2]]: item.code,
        [FSE_BENEFICIARI_HEADERS[3]]: new Date(`${item.beneficiario.dataPresaInCarico}T12:00:00Z`),
        [FSE_BENEFICIARI_HEADERS[4]]: demographics.numeroComponenti,
        [FSE_BENEFICIARI_HEADERS[5]]: mapDeliveryToFseActivity(item.beneficiario.consegnaDomicilio),
        [FSE_BENEFICIARI_HEADERS[6]]: mapActiveToFseState(item.beneficiario.attivo)!,
        [FSE_BENEFICIARI_HEADERS[7]]: demographics.donne,
        [FSE_BENEFICIARI_HEADERS[8]]: demographics.uomini,
        [FSE_BENEFICIARI_HEADERS[9]]: demographics.eta017,
        [FSE_BENEFICIARI_HEADERS[10]]: demographics.eta1829,
        [FSE_BENEFICIARI_HEADERS[11]]: demographics.eta3064,
        [FSE_BENEFICIARI_HEADERS[12]]: demographics.eta65Plus,
        [FSE_BENEFICIARI_HEADERS[13]]: profile!.origineStranieraMinoranze!,
        [FSE_BENEFICIARI_HEADERS[14]]: item.beneficiario.numDisabili,
        [FSE_BENEFICIARI_HEADERS[15]]: profile!.cittadiniPaesiTerzi!,
        [FSE_BENEFICIARI_HEADERS[16]]: profile!.senzaTettoEsclusioneAbitativa!,
      };
    });
    const buffer = buildFseBeneficiariWorkbook(outputRows);
    const workbookHash = createHash("sha256").update(buffer).digest("hex");
    await db.transaction(async (tx) => {
      const exportedAt = new Date();
      for (const item of result.rows) {
        await tx.insert(fseFascicoliSocialiTable).values({
          beneficiarioId: item.beneficiario.id,
          codiceFascicolo: item.code,
          codiceFascicoloNormalizzato: normalizeFseCode(item.code),
          origineFascicolo: item.profilo?.origineFascicolo ?? "interno",
          ultimoExportAt: exportedAt,
          dataAggiornamento: exportedAt,
        }).onConflictDoUpdate({
          target: fseFascicoliSocialiTable.beneficiarioId,
          set: {
            codiceFascicolo: item.code,
            codiceFascicoloNormalizzato: normalizeFseCode(item.code),
            ultimoExportAt: exportedAt,
            dataAggiornamento: exportedAt,
          },
        });
      }
      await tx.insert(auditConfigurazioniTable).values({
        area: "beneficiari",
        chiave: `fse-export:${result.scoped.centro.id}`,
        azione: "export-fse",
        valoreNuovo: {
          centroAscoltoId: result.scoped.centro.id,
          areaOperativaId: result.scoped.centro.areaOperativaId,
          numeroRighe: outputRows.length,
          dataRiferimento: result.dateRaw,
          sha256Workbook: workbookHash,
        },
        utenteId: req.user?.id ?? null,
        ip: req.ip ?? req.socket.remoteAddress ?? null,
      });
    });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="beneficiari-fse-${result.dateRaw}.xlsx"`);
    res.send(buffer);
  },
);

router.get(
  "/beneficiari/:id/fse",
  requirePermission("beneficiari.fse.view"),
  async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) {
      res.status(400).json({ error: "Beneficiario non valido." });
      return;
    }
    const [row] = await db
      .select({ profilo: fseFascicoliSocialiTable, beneficiario: beneficiariTable })
      .from(beneficiariTable)
      .leftJoin(
        fseFascicoliSocialiTable,
        eq(fseFascicoliSocialiTable.beneficiarioId, beneficiariTable.id),
      )
      .where(eq(beneficiariTable.id, id));
    if (!row) { res.status(404).json({ error: "Beneficiario non trovato." }); return; }
    if (!canAccessBeneficiarioRecord(row.beneficiario, req)) {
      res.status(403).json({ error: "Beneficiario non accessibile." });
      return;
    }
    const nucleo = await db.select().from(nucleoFamiliareTable)
      .where(eq(nucleoFamiliareTable.beneficiarioId, id));
    const snapshot = snapshotFromProfile(row.profilo);
    const demografia = calcolaDemografiaNucleo(row.beneficiario, nucleo, new Date(), snapshot);
    res.json({
      profilo: row.profilo,
      snapshot,
      disabili: row.beneficiario.numDisabili,
      componentiDichiarati: row.beneficiario.numComponenti,
      componentiDettagliati: 1 + nucleo.length,
      demografia,
      confronto: confrontaDemografia(snapshot, demografia),
    });
  },
);

router.patch(
  "/beneficiari/:id/fse",
  requirePermission("beneficiari.fse.manage"),
  async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) {
      res.status(400).json({ error: "Beneficiario non valido." });
      return;
    }
    const [beneficiario] = await db.select().from(beneficiariTable)
      .where(eq(beneficiariTable.id, id));
    if (!beneficiario) { res.status(404).json({ error: "Beneficiario non trovato." }); return; }
    if (!canAccessBeneficiarioRecord(beneficiario, req)) {
      res.status(403).json({ error: "Beneficiario non accessibile." });
      return;
    }
    const body = req.body as Record<string, unknown>;
    const allowed = new Set([
      "codiceFascicolo",
      "origineStranieraMinoranze",
      "cittadiniPaesiTerzi",
      "senzaTettoEsclusioneAbitativa",
    ]);
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      !Object.keys(body).length ||
      Object.keys(body).some((key) => !allowed.has(key))
    ) {
      res.status(400).json({ error: "Nessun campo FSE+ valido da aggiornare." });
      return;
    }
    const [existingProfile] = await db.select().from(fseFascicoliSocialiTable)
      .where(eq(fseFascicoliSocialiTable.beneficiarioId, id));
    const code = body.codiceFascicolo == null ? undefined : String(body.codiceFascicolo).trim();
    const numeric = [
      "origineStranieraMinoranze",
      "cittadiniPaesiTerzi",
      "senzaTettoEsclusioneAbitativa",
    ] as const;
    const changes: Record<string, unknown> = { dataAggiornamento: new Date() };
    if (code !== undefined) {
      if (!code || code.length > 255) {
        res.status(400).json({ error: "Codice fascicolo non valido." });
        return;
      }
      changes.codiceFascicolo = code;
      changes.codiceFascicoloNormalizzato = normalizeFseCode(code);
    }
    for (const key of numeric) {
      if (!(key in body)) continue;
      if (body[key] === null) {
        changes[key] = null;
        continue;
      }
      const value = Number(body[key]);
      if (!Number.isInteger(value) || value < 0 || value > beneficiario.numComponenti) {
        res.status(400).json({ error: `${key} non valido.` });
        return;
      }
      changes[key] = value;
    }
    try {
      const [updated] = await db.transaction(async (tx) => {
        const result = await tx.insert(fseFascicoliSocialiTable).values({
          beneficiarioId: id,
          codiceFascicolo: code ?? null,
          codiceFascicoloNormalizzato: code ? normalizeFseCode(code) : null,
          ...changes,
        }).onConflictDoUpdate({
          target: fseFascicoliSocialiTable.beneficiarioId,
          set: changes,
        }).returning();
        await tx.insert(auditConfigurazioniTable).values({
          area: "beneficiari",
          chiave: `beneficiario:${id}:fse`,
          azione: code !== undefined && code !== existingProfile?.codiceFascicolo
            ? "modifica-codice-fascicolo-fse"
            : "modifica-fascicolo-fse",
          valoreNuovo: {
            beneficiarioId: id,
            campiModificati: Object.keys(changes).filter((key) => key !== "dataAggiornamento"),
          },
          utenteId: req.user?.id ?? null,
          ip: req.ip ?? req.socket.remoteAddress ?? null,
        });
        return result;
      });
      res.json(updated);
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        res.status(409).json({ error: "Codice fascicolo FSE+ già associato." });
        return;
      }
      throw error;
    }
  },
);

export default router;
