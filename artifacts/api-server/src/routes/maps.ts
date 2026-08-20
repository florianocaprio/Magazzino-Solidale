import { Router, type IRouter, type Request, type RequestHandler } from "express";
import {
  beneficiariTable,
  bolleTable,
  centriAscoltoTable,
  consegneTable,
  db,
  interventiTable,
  magazziniTable,
} from "@workspace/db";
import {
  and,
  eq,
  gte,
  isNotNull,
  isNull,
  lt,
  lte,
  type SQL,
} from "drizzle-orm";
import { isModuloAttivo, requireAllModuli, requireModulo } from "../lib/featureFlags";
import {
  callerCentroId,
  callerAreaOperativaId,
  callerZonaUdsId,
  centroScopeFilter,
  areaOperativaScopeFilter,
  zonaUdsScopeFilter,
  magazzinoScopeFilter,
  visibleMagazzinoIds,
  canAccessCentro,
  canAccessAreaOperativa,
  canAccessZonaUds,
  canAccessMagazzino,
  beneficiarioCentroId,
  beneficiarioAreaOperativaId,
  beneficiarioZonaUdsId,
} from "../lib/centroScope";
import { dataCivileEuropeRome, isDateOnly } from "../lib/interventiWorkflow";
import { intervalloDateEuropeRome } from "../lib/interventiViste";

const router: IRouter = Router();
const TIPO_CONSEGNA_PACCO = "consegna_pacco";
const MAX_WINDOW_DAYS = 31;

type MapsLayerCode =
  | "sociale.interventi_pianificati"
  | "pacchi.consegne"
  | "pacchi.ritiri_non_effettuati"
  | "centro.punti_operativi";

type MapsMarker = {
  id: string;
  layer: MapsLayerCode;
  entityType: "intervento" | "consegna" | "bolla" | "magazzino" | "centro_ascolto";
  entityId: number;
  title: string;
  subtitle: string | null;
  status: string;
  address: string;
  date: string | null;
  actions: Array<"open" | "route" | "convert_delivery">;
};

// Admin e SuperAdmin possono usare la funzione MAPS senza aree applicative
// assegnate. Gli scope territoriali restano separati e sono sempre ricavati
// dai caller*Id(req) nei singoli handler, senza bypass basati sul ruolo.
function isMapsApplicationAdministrator(req: Request): boolean {
  return req.user?.isAdmin === true || req.user?.isSuperAdmin === true;
}

function hasMapsArea(req: Request, area: string): boolean {
  return !!req.user
    && (isMapsApplicationAdministrator(req) || req.user.aree.includes(area));
}

function hasMapsPermission(req: Request, permission: string): boolean {
  return !!req.user
    && (isMapsApplicationAdministrator(req) || req.user.permessi.includes(permission));
}

function requireMapsPermission(permission: string): RequestHandler {
  return (req, res, next) => {
    if (!req.user) {
      res.status(401).json({ error: "Non autenticato" });
      return;
    }
    if (hasMapsPermission(req, permission)) {
      next();
      return;
    }
    res.status(403).json({ error: "Permesso non consentito per il ruolo" });
  };
}

function addCivilDays(value: string, days: number): string {
  const [year, month, day] = value.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return [
    next.getUTCFullYear(),
    String(next.getUTCMonth() + 1).padStart(2, "0"),
    String(next.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function dateWindow(req: Request): { da: string; a: string; start: Date; end: Date } {
  const today = dataCivileEuropeRome();
  const da = typeof req.query.da === "string" ? req.query.da : today;
  const a = typeof req.query.a === "string" ? req.query.a : addCivilDays(da, 7);
  if (!isDateOnly(da) || !isDateOnly(a)) throw new Error("da e a devono essere date YYYY-MM-DD");
  const from = Date.parse(`${da}T00:00:00Z`);
  const to = Date.parse(`${a}T00:00:00Z`);
  if (to < from) throw new Error("a deve essere uguale o successiva a da");
  if ((to - from) / 86_400_000 > MAX_WINDOW_DAYS) {
    throw new Error(`L'intervallo massimo è di ${MAX_WINDOW_DAYS} giorni`);
  }
  return { da, a, ...intervalloDateEuropeRome(da, a) };
}

function sendDateWindowError(error: unknown, res: import("express").Response): void {
  res.status(400).json({ error: error instanceof Error ? error.message : "Intervallo non valido" });
}

async function capabilities(req: Request) {
  const layers: Array<{ code: MapsLayerCode; domain: string; label: string; routeSupported: boolean }> = [];
  const operational = hasMapsPermission(req, "maps.operational");
  if (!operational) return { operational: false, layers };

  const [centro, consegne, magazzino, bolle, uds] = await Promise.all([
    isModuloAttivo("CENTRO_ASCOLTO"),
    isModuloAttivo("CONSEGNE"),
    isModuloAttivo("MAGAZZINO_SOLIDALE"),
    isModuloAttivo("BOLLE"),
    isModuloAttivo("UDS"),
  ]);
  if (hasMapsArea(req, "sociale") && centro) {
    layers.push({ code: "sociale.interventi_pianificati", domain: "sociale", label: "Interventi pianificati", routeSupported: false });
  }
  if (hasMapsArea(req, "sociale") && centro && consegne) {
    layers.push({ code: "pacchi.consegne", domain: "pacchi", label: "Consegne a domicilio", routeSupported: hasMapsPermission(req, "maps.route") });
  }
  if (hasMapsArea(req, "sociale") && magazzino && bolle) {
    layers.push({ code: "pacchi.ritiri_non_effettuati", domain: "pacchi", label: "Ritiri non effettuati", routeSupported: false });
  }
  if ((hasMapsArea(req, "magazzino") || hasMapsArea(req, "sociale")) && magazzino) {
    layers.push({ code: "centro.punti_operativi", domain: "centro", label: "Punti operativi", routeSupported: false });
  }
  // Il modulo UDS viene valutato intenzionalmente: finché il dominio non espone
  // una localizzazione semantica dell'intervento, nessuna capability viene resa.
  void uds;
  return { operational, layers };
}

router.get("/maps/capabilities", async (req, res) => {
  res.json(await capabilities(req));
});

router.get(
  "/maps/layers/sociale/interventi",
  requireMapsPermission("maps.operational"),
  requireModulo("CENTRO_ASCOLTO"),
  async (req, res) => {
    if (!hasMapsArea(req, "sociale")) { res.status(403).json({ error: "Area Sociale non consentita" }); return; }
    let range: ReturnType<typeof dateWindow>;
    try { range = dateWindow(req); } catch (error) { sendDateWindowError(error, res); return; }
    const conditions: SQL[] = [
      eq(interventiTable.ambito, "sociale"),
      eq(interventiTable.stato, "pianificato"),
      gte(interventiTable.dataOraPianificata, range.start),
      lt(interventiTable.dataOraPianificata, range.end),
      isNotNull(interventiTable.sede),
    ];
    const centro = centroScopeFilter(beneficiariTable.centroAscoltoId, callerCentroId(req));
    const areaOperativa = areaOperativaScopeFilter(beneficiariTable.areaOperativaId, callerAreaOperativaId(req));
    const zona = zonaUdsScopeFilter(beneficiariTable.zonaUdsId, callerZonaUdsId(req));
    if (centro) conditions.push(centro);
    if (areaOperativa) conditions.push(areaOperativa);
    if (zona) conditions.push(zona);
    const rows = await db.select({ id: interventiTable.id, tipo: interventiTable.tipoIntervento, stato: interventiTable.stato, sede: interventiTable.sede, data: interventiTable.dataOraPianificata })
      .from(interventiTable)
      .innerJoin(beneficiariTable, eq(interventiTable.beneficiarioId, beneficiariTable.id))
      .where(and(...conditions)).limit(500);
    const markers: MapsMarker[] = rows.flatMap((row) => row.sede?.trim() ? [{
      id: `sociale.intervento:${row.id}`,
      layer: "sociale.interventi_pianificati",
      entityType: "intervento",
      entityId: row.id,
      title: row.tipo,
      subtitle: null,
      status: row.stato,
      address: row.sede.trim(),
      date: row.data?.toISOString() ?? null,
      actions: ["open"],
    }] : []);
    res.json(markers);
  },
);

router.get(
  "/maps/layers/pacchi/consegne",
  requireMapsPermission("maps.operational"),
  requireAllModuli(["CENTRO_ASCOLTO", "CONSEGNE"]),
  async (req, res) => {
    if (!hasMapsArea(req, "sociale")) { res.status(403).json({ error: "Area Sociale non consentita" }); return; }
    let range: ReturnType<typeof dateWindow>;
    try { range = dateWindow(req); } catch (error) { sendDateWindowError(error, res); return; }
    const conditions: SQL[] = [
      eq(consegneTable.tipoPianificazione, TIPO_CONSEGNA_PACCO),
      eq(consegneTable.tipoConsegna, "domicilio"),
      gte(consegneTable.dataPrevista, range.da),
      lte(consegneTable.dataPrevista, range.a),
      isNotNull(consegneTable.indirizzoConsegna),
    ];
    const centro = centroScopeFilter(beneficiariTable.centroAscoltoId, callerCentroId(req));
    const areaOperativa = areaOperativaScopeFilter(beneficiariTable.areaOperativaId, callerAreaOperativaId(req));
    const zona = zonaUdsScopeFilter(beneficiariTable.zonaUdsId, callerZonaUdsId(req));
    const warehouse = magazzinoScopeFilter(consegneTable.magazzinoId, await visibleMagazzinoIds(callerCentroId(req), callerAreaOperativaId(req)));
    for (const scoped of [centro, areaOperativa, zona, warehouse]) if (scoped) conditions.push(scoped);
    const rows = await db.select({ id: consegneTable.id, codice: consegneTable.codice, stato: consegneTable.stato, indirizzo: consegneTable.indirizzoConsegna, data: consegneTable.dataPrevista, fascia: consegneTable.fasciaOraria })
      .from(consegneTable).innerJoin(beneficiariTable, eq(consegneTable.beneficiarioId, beneficiariTable.id))
      .where(and(...conditions)).limit(500);
    const routeAllowed = hasMapsPermission(req, "maps.route");
    const markers: MapsMarker[] = rows.flatMap((row) => row.indirizzo?.trim() ? [{
      id: `pacchi.consegna:${row.id}`,
      layer: "pacchi.consegne",
      entityType: "consegna",
      entityId: row.id,
      title: `Consegna ${row.codice}`,
      subtitle: row.fascia ?? null,
      status: row.stato,
      address: row.indirizzo.trim(),
      date: row.data,
      actions: routeAllowed ? ["open", "route"] : ["open"],
    }] : []);
    res.json(markers);
  },
);

router.get(
  "/maps/layers/pacchi/ritiri-non-effettuati",
  requireMapsPermission("maps.operational"),
  requireAllModuli(["MAGAZZINO_SOLIDALE", "BOLLE"]),
  async (req, res) => {
    if (!hasMapsArea(req, "sociale")) { res.status(403).json({ error: "Area Sociale non consentita" }); return; }
    let range: ReturnType<typeof dateWindow>;
    try { range = dateWindow(req); } catch (error) { sendDateWindowError(error, res); return; }
    const conditions: SQL[] = [
      isNotNull(bolleTable.ritiroNonEffettuatoAt),
      isNull(bolleTable.consegnaId),
      gte(bolleTable.ritiroNonEffettuatoAt, range.start),
      lt(bolleTable.ritiroNonEffettuatoAt, range.end),
      isNotNull(beneficiariTable.domicilio),
    ];
    const centro = centroScopeFilter(beneficiariTable.centroAscoltoId, callerCentroId(req));
    const areaOperativa = areaOperativaScopeFilter(beneficiariTable.areaOperativaId, callerAreaOperativaId(req));
    const zona = zonaUdsScopeFilter(beneficiariTable.zonaUdsId, callerZonaUdsId(req));
    const warehouse = magazzinoScopeFilter(bolleTable.magazzinoId, await visibleMagazzinoIds(callerCentroId(req), callerAreaOperativaId(req)));
    for (const scoped of [centro, areaOperativa, zona, warehouse]) if (scoped) conditions.push(scoped);
    const rows = await db.select({ id: bolleTable.id, numero: bolleTable.numeroBolla, stato: bolleTable.stato, at: bolleTable.ritiroNonEffettuatoAt, indirizzo: beneficiariTable.domicilio, magazzino: magazziniTable.nome })
      .from(bolleTable)
      .innerJoin(beneficiariTable, eq(bolleTable.beneficiarioId, beneficiariTable.id))
      .innerJoin(magazziniTable, eq(bolleTable.magazzinoId, magazziniTable.id))
      .where(and(...conditions)).limit(500);
    const markers: MapsMarker[] = rows.flatMap((row) => row.indirizzo?.trim() ? [{
      id: `pacchi.bolla:${row.id}`,
      layer: "pacchi.ritiri_non_effettuati",
      entityType: "bolla",
      entityId: row.id,
      title: `Ritiro ${row.numero}`,
      subtitle: row.magazzino,
      status: "ritiro_non_effettuato",
      address: row.indirizzo.trim(),
      date: row.at?.toISOString() ?? null,
      actions: ["open", "convert_delivery"],
    }] : []);
    res.json(markers);
  },
);

router.get(
  "/maps/layers/centro/punti-operativi",
  requireMapsPermission("maps.operational"),
  requireModulo("MAGAZZINO_SOLIDALE"),
  async (req, res) => {
    if (!hasMapsArea(req, "magazzino") && !hasMapsArea(req, "sociale")) { res.status(403).json({ error: "Area operativa non consentita" }); return; }
    const visibleWarehouses = await visibleMagazzinoIds(callerCentroId(req), callerAreaOperativaId(req));
    const warehouseCondition = magazzinoScopeFilter(magazziniTable.id, visibleWarehouses);
    const warehouses = await db.select({ id: magazziniTable.id, nome: magazziniTable.nome, stato: magazziniTable.stato, indirizzo: magazziniTable.indirizzo, comune: magazziniTable.comune })
      .from(magazziniTable)
      .where(and(warehouseCondition, eq(magazziniTable.stato, "attivo"), isNotNull(magazziniTable.indirizzo))).limit(300);
    const centreConditions: SQL[] = [eq(centriAscoltoTable.attivo, true), isNotNull(centriAscoltoTable.indirizzo)];
    const centre = centroScopeFilter(centriAscoltoTable.id, callerCentroId(req));
    const areaOperativa = areaOperativaScopeFilter(centriAscoltoTable.areaOperativaId, callerAreaOperativaId(req));
    if (centre) centreConditions.push(centre);
    if (areaOperativa) centreConditions.push(areaOperativa);
    const centres = await db.select({ id: centriAscoltoTable.id, nome: centriAscoltoTable.nome, indirizzo: centriAscoltoTable.indirizzo, comune: centriAscoltoTable.comune })
      .from(centriAscoltoTable).where(and(...centreConditions)).limit(300);
    const markers: MapsMarker[] = [
      ...warehouses.flatMap((row) => row.indirizzo?.trim() ? [{ id: `centro.magazzino:${row.id}`, layer: "centro.punti_operativi" as const, entityType: "magazzino" as const, entityId: row.id, title: row.nome, subtitle: "Magazzino", status: row.stato, address: [row.indirizzo.trim(), row.comune].filter(Boolean).join(", "), date: null, actions: ["open" as const] }] : []),
      ...centres.flatMap((row) => row.indirizzo?.trim() ? [{ id: `centro.ascolto:${row.id}`, layer: "centro.punti_operativi" as const, entityType: "centro_ascolto" as const, entityId: row.id, title: row.nome, subtitle: "Centro di ascolto", status: "attivo", address: [row.indirizzo.trim(), row.comune].filter(Boolean).join(", "), date: null, actions: ["open" as const] }] : []),
    ];
    res.json(markers);
  },
);

router.get(
  "/maps/routes/consegne/:id",
  requireMapsPermission("maps.route"),
  requireAllModuli(["CENTRO_ASCOLTO", "CONSEGNE"]),
  async (req, res) => {
    if (!hasMapsArea(req, "sociale")) { res.status(403).json({ error: "Area Sociale non consentita" }); return; }
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "ID consegna non valido" }); return; }
    const [row] = await db.select({ consegna: consegneTable, origine: magazziniTable.indirizzo, origineComune: magazziniTable.comune })
      .from(consegneTable).innerJoin(magazziniTable, eq(consegneTable.magazzinoId, magazziniTable.id))
      .where(eq(consegneTable.id, id));
    if (!row || row.consegna.tipoPianificazione !== TIPO_CONSEGNA_PACCO) { res.status(404).json({ error: "Consegna non trovata" }); return; }
    const { consegna } = row;
    if (!canAccessCentro(await beneficiarioCentroId(consegna.beneficiarioId), callerCentroId(req))
      || !canAccessAreaOperativa(await beneficiarioAreaOperativaId(consegna.beneficiarioId), callerAreaOperativaId(req))
      || !canAccessZonaUds(await beneficiarioZonaUdsId(consegna.beneficiarioId), callerZonaUdsId(req))
      || !(await canAccessMagazzino(consegna.magazzinoId, callerCentroId(req), callerAreaOperativaId(req)))) {
      res.status(403).json({ error: "Consegna non accessibile" }); return;
    }
    if (consegna.tipoConsegna !== "domicilio") { res.status(422).json({ error: "Il percorso è disponibile solo per consegne a domicilio" }); return; }
    const origin = [row.origine?.trim(), row.origineComune?.trim()].filter(Boolean).join(", ");
    const destination = consegna.indirizzoConsegna?.trim() ?? "";
    if (!origin) { res.status(422).json({ error: "Il magazzino non ha un indirizzo utilizzabile" }); return; }
    if (!destination) { res.status(422).json({ error: "La consegna non ha uno snapshot dell'indirizzo" }); return; }
    const url = new URL("https://www.google.com/maps/dir/");
    url.searchParams.set("api", "1");
    url.searchParams.set("origin", origin);
    url.searchParams.set("destination", destination);
    url.searchParams.set("travelmode", "driving");
    url.searchParams.set("dir_action", "navigate");
    res.json({ origin, destination, provider: "google-maps-url", url: url.toString() });
  },
);

export default router;
