import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  pool,
  ruoliTable,
  utentiTable,
  areeOperativeTable,
  centriAscoltoTable,
  magazziniTable,
  fornitoriTable,
  prodottiTable,
  volontariTable,
  beneficiariTable,
  consegneTable,
  bolleTable, bollaRigheTable, richiesteMagazzinoTable, richiesteMagazzinoDocumentiTable,
  menseTable,
  ambienteModuliTable,
  moduliFunzionaliTable,
} from "@workspace/db";
import app from "../src/app";
import { STANDARD_ROLE_PROFILES, seedRoles } from "../src/lib/seedRoles";
import { ensureAmbienteModuli } from "../src/lib/configurazioneAmbiente";

const suffix = randomUUID().slice(0, 8);
const password = `Bug6-test-${randomUUID()}`;
const roles = new Map<
  string,
  { id: number; userId: number; username: string; grants: string[] }
>();
const agents = new Map<string, ReturnType<typeof request.agent>>();
const areaIds: number[] = [],
  centreIds: number[] = [],
  warehouseIds: number[] = [],
  supplierIds: number[] = [],
  volunteerIds: number[] = [],
  beneficiaryIds: number[] = [],
  deliveryIds: number[] = [],
  mensaIds: number[] = [];
const bollaIds: number[] = [], requestIds: number[] = [];
let productId: number;
let moduleBefore: Array<{ id: number; attivo: boolean }> = [];

beforeAll(async () => {
  // This suite is discovered only through the canonical attested disposable DB runner.
  expect(process.env.NODE_ENV).toBe("test");
  expect(new URL(process.env.DATABASE_URL!).hostname).toBe("127.0.0.1");
  await ensureAmbienteModuli();
  moduleBefore = await db
    .select({ id: ambienteModuliTable.id, attivo: ambienteModuliTable.attivo })
    .from(ambienteModuliTable);
  await db.update(ambienteModuliTable).set({ attivo: true });
  for (const letter of ["A", "B"]) {
    const [area] = await db
      .insert(areeOperativeTable)
      .values({ nome: `BUG6-${suffix}-${letter}`, attivo: true })
      .returning();
    areaIds.push(area.id);
    const [centre] = await db
      .insert(centriAscoltoTable)
      .values({
        nome: `BUG6-centre-${suffix}-${letter}`,
        areaOperativaId: area.id,
      })
      .returning();
    centreIds.push(centre.id);
    const [warehouse] = await db
      .insert(magazziniTable)
      .values({
        codice: `B6-${suffix}-${letter}`,
        nome: `BUG6-stock-${suffix}-${letter}`,
        areaOperativaId: area.id,
        centroAscoltoId: centre.id,
        tipoMagazzino: "misto",
      })
      .returning();
    warehouseIds.push(warehouse.id);
    const [supplier] = await db
      .insert(fornitoriTable)
      .values({
        nome: `BUG6-supplier-${suffix}-${letter}`,
        tipo: "altro",
        areaOperativaId: area.id,
        email: "private@example.test",
        note: "PRIVATE-NOTES",
      })
      .returning();
    supplierIds.push(supplier.id);
    const [volunteer] = await db
      .insert(volontariTable)
      .values({
        nome: `BUG6-${letter}`,
        cognome: suffix,
        areaOperativaId: area.id,
        centroAscoltoId: centre.id,
        ruolo: "autista",
        telefono: "PRIVATE-PHONE",
        note: "PRIVATE-NOTES",
        statoApprovazione: "approvato",
        attivo: true,
      })
      .returning();
    volunteerIds.push(volunteer.id);
    const [person] = await db
      .insert(beneficiariTable)
      .values({
        nome: "BUG6",
        cognome: suffix + letter,
        codice: `BUG6-${suffix}-${letter}`,
        areaOperativaId: area.id,
        centroAscoltoId: centre.id,
      })
      .returning();
    beneficiaryIds.push(person.id);
    const [delivery] = await db
      .insert(consegneTable)
      .values({
        codice: `BUG6-${suffix}-${letter}`,
        beneficiarioId: person.id,
        magazzinoId: warehouse.id,
        tipoConsegna: "domicilio",
        indirizzoConsegna: "Via Sintetica 1",
        dataPrevista: "2026-10-22",
      })
      .returning();
    deliveryIds.push(delivery.id);
    const [mensa] = await db
      .insert(menseTable)
      .values({
        codice: `BUG6-${suffix}-${letter}`,
        nome: `BUG6 Mensa ${letter}`,
        magazzinoId: warehouse.id,
        areaOperativaId: area.id,
      })
      .returning();
    mensaIds.push(mensa.id);
  }
  const [globalSupplier] = await db
    .insert(fornitoriTable)
    .values({
      nome: `BUG6-global-${suffix}`,
      tipo: "altro",
      areaOperativaId: null,
    })
    .returning();
  supplierIds.push(globalSupplier.id);
  const [product] = await db
    .insert(prodottiTable)
    .values({
      codice: `BUG6-${suffix}`,
      nome: "Prodotto sintetico",
      tipoProdotto: "alimentare",
      unitaMisura: "pz",
    })
    .returning();
  productId = product.id;
  const hash = await bcrypt.hash(password, 4);
  const profiles = [
    ...STANDARD_ROLE_PROFILES,
    {
      nome: "Custom generale",
      aree: ["generale"],
      permessi: [],
      isAdmin: false,
    },
    {
      nome: "Custom readonly",
      aree: ["magazzino"],
      permessi: ["magazzino.view"],
      isAdmin: false,
    },
    {
      nome: "Custom multi",
      aree: ["uds", "logistica"],
      permessi: [
        "uds.directory.view",
        "uds.reports.view",
        "consegne.view",
        "logistica.turni.view",
      ],
      isAdmin: false,
    },
  ];
  for (const profile of profiles) {
    const [role] = await db
      .insert(ruoliTable)
      .values({
        nome: `B6-${suffix}-${profile.nome}`,
        aree: [...profile.aree],
        permessi: [...profile.permessi],
        isAdmin: profile.isAdmin,
      })
      .returning();
    const username = `b6-${suffix}-${role.id}`;
    const [user] = await db
      .insert(utentiTable)
      .values({
        username,
        email: `${username}@example.test`,
        emailDaAggiornare: false,
        nome: "Synthetic",
        passwordHash: hash,
        ruoloId: role.id,
        areaOperativaId: profile.isAdmin ? null : areaIds[0],
        isSuperAdmin: profile.nome === "SuperAdmin",
        attivo: true,
        mustChangePassword: false,
      })
      .returning();
    roles.set(profile.nome, {
      id: role.id,
      userId: user.id,
      username,
      grants: [...profile.permessi],
    });
    const agent = request.agent(app);
    const login = await agent
      .post("/api/auth/login")
      .send({ username, password });
    expect(login.status, profile.nome).toBe(200);
    expect(login.body.isAdmin).toBe(profile.isAdmin);
    expect(login.body.isSuperAdmin).toBe(profile.nome === "SuperAdmin");
    agents.set(profile.nome, agent);
  }
  for (let i = 0; i < areaIds.length; i++) {
    const [bolla] = await db.insert(bolleTable).values({ numeroBolla: `B6-${suffix}-${i}`, dataBolla: "2026-10-22", beneficiarioId: beneficiaryIds[i], consegnaId: deliveryIds[i], magazzinoId: warehouseIds[i], stato: "confermato", noteRicezione: "PRIVATE-RECEIPT", motivoAnnullamento: "PRIVATE-AUDIT" }).returning();
    bollaIds.push(bolla.id);
    await db.insert(bollaRigheTable).values({ bollaId: bolla.id, prodottoId: productId, quantita: "2", unitaMisura: "pz", note: "PRIVATE-LINE" });
    const [req] = await db.insert(richiesteMagazzinoTable).values({ codice: `B6-REQ-${suffix}-${i}`, tipoDestinatario: "beneficiario", beneficiarioId: beneficiaryIds[i], areaOperativaId: areaIds[i], centroAscoltoId: centreIds[i], sorgente: "beneficiario", destinatarioNomeSnapshot: "Synthetic", areaNomeSnapshot: "Synthetic", bisogno: "PRIVATE-REQUEST", inviatoDa: roles.get("Operatore")!.userId }).returning();
    requestIds.push(req.id);
    await db.insert(richiesteMagazzinoDocumentiTable).values({ richiestaId: req.id, tipoDocumento: "bolla", bollaId: bolla.id, creatoDa: roles.get("Operatore Magazzino")!.userId });
  }

}, 60_000);

afterAll(async () => {
  for (const row of moduleBefore)
    await db
      .update(ambienteModuliTable)
      .set({ attivo: row.attivo })
      .where(eq(ambienteModuliTable.id, row.id));
  if (requestIds.length) {
    await db.delete(richiesteMagazzinoDocumentiTable).where(inArray(richiesteMagazzinoDocumentiTable.richiestaId, requestIds));
    await db.delete(richiesteMagazzinoTable).where(inArray(richiesteMagazzinoTable.id, requestIds));
  }
  if (bollaIds.length) {
    await db.delete(bollaRigheTable).where(inArray(bollaRigheTable.bollaId, bollaIds));
    await db.delete(bolleTable).where(inArray(bolleTable.id, bollaIds));
  }
  if (deliveryIds.length)
    await db
      .delete(consegneTable)
      .where(inArray(consegneTable.id, deliveryIds));
  if (mensaIds.length)
    await db.delete(menseTable).where(inArray(menseTable.id, mensaIds));
  if (beneficiaryIds.length)
    await db
      .delete(beneficiariTable)
      .where(inArray(beneficiariTable.id, beneficiaryIds));
  if (volunteerIds.length)
    await db
      .delete(volontariTable)
      .where(inArray(volontariTable.id, volunteerIds));
  if (supplierIds.length)
    await db
      .delete(fornitoriTable)
      .where(inArray(fornitoriTable.id, supplierIds));
  if (productId)
    await db.delete(prodottiTable).where(eq(prodottiTable.id, productId));
  if (warehouseIds.length)
    await db
      .delete(magazziniTable)
      .where(inArray(magazziniTable.id, warehouseIds));
  if (centreIds.length)
    await db
      .delete(centriAscoltoTable)
      .where(inArray(centriAscoltoTable.id, centreIds));
  if (roles.size) {
    await db.delete(utentiTable).where(
      inArray(
        utentiTable.id,
        [...roles.values()].map((role) => role.userId),
      ),
    );
    await db.delete(ruoliTable).where(
      inArray(
        ruoliTable.id,
        [...roles.values()].map((role) => role.id),
      ),
    );
  }
  if (areaIds.length)
    await db
      .delete(areeOperativeTable)
      .where(inArray(areeOperativeTable.id, areaIds));
  await pool.end();
});

const agent = (role: string) => agents.get(role)!;
const period = { da: "2026-10-22", a: "2026-10-22" };

describe("BUG6 — identità reali, sessioni normali e catena middleware completa", () => {
  it("UDS usa report, filtri, drilldown e preparazione senza Analisi", async () => {
    const uds = agent("Operatore UDS");
    for (const path of [
      "/uds/directory",
      "/report/uds",
      "/report/uds/interventi-giornalieri",
      "/report/filter-options?section=uds",
    ]) {
      const response = await uds.get("/api" + path).query(period);
      expect(response.status, `${path}: ${JSON.stringify(response.body)}`).toBe(
        200,
      );
    }
    expect(
      (
        await uds
          .post("/api/report/prepare")
          .query({ ...period, section: "uds", language: "it" })
      ).status,
    ).toBe(200);
    for (const section of ["mensa", "centro-ascolto", "fse-plus", "generale"])
      expect(
        (await uds.post("/api/report/prepare").query({ ...period, section }))
          .status,
      ).toBe(403);
    expect((await uds.get("/api/report/mensa").query(period)).status).toBe(403);
    expect(
      (
        await uds
          .get("/api/report/uds")
          .query({ ...period, areaOperativaId: areaIds[1] })
      ).status,
    ).toBe(403);
  });

  it("Sociale pianifica con selezioni minimizzate senza aprire gli archivi", async () => {
    const social = agent("Operatore");
    for (const resource of [
      "magazzini",
      "volontari",
      "mezzi",
      "ruoli-volontari",
      "carico-volontari",
    ]) {
      const response = await social
        .get(`/api/operativita/${resource}`)
        .query({ contesto: "consegne", data: "2026-10-22", fascia: "09-13" });
      expect(response.status, resource).toBe(200);
      if (resource === "volontari") {
        expect(
          response.body.some(
            (row: { id: number }) => row.id === volunteerIds[0],
          ),
        ).toBe(true);
        expect(
          response.body.some(
            (row: { id: number }) => row.id === volunteerIds[1],
          ),
        ).toBe(false);
        for (const row of response.body) {
          expect(row).not.toHaveProperty("telefono");
          expect(row).not.toHaveProperty("note");
          expect(row).not.toHaveProperty("codiceFiscale");
        }
      }
    }
    for (const path of ["magazzini", "volontari", "mezzi"])
      expect((await social.get(`/api/${path}`)).status).toBe(403);
    expect((await social.post("/api/bolle").send({})).status).toBe(403);
    expect(
      (await social.get("/api/report/centro-ascolto").query(period)).status,
    ).toBe(200);
  });

  it("Magazzino legge nomi dei fornitori locali/globali senza dossier o gestione", async () => {
    const warehouse = agent("Operatore Magazzino");
    const response = await warehouse
      .get("/api/operativita/fornitori")
      .query({ contesto: "magazzino" });
    expect(response.status).toBe(200);
    const ids = response.body.map((row: { id: number }) => row.id);
    expect(ids).toContain(supplierIds[0]);
    expect(ids).toContain(supplierIds[2]);
    expect(ids).not.toContain(supplierIds[1]);
    expect(
      Object.keys(
        response.body.find((row: { id: number }) => row.id === supplierIds[0]),
      ).sort(),
    ).toEqual(["areaOperativaId", "attivo", "id", "nome", "tipo"]);
    expect(
      (await warehouse.get(`/api/fornitori/${supplierIds[0]}`)).status,
    ).toBe(403);
    expect(
      (
        await warehouse
          .post("/api/fornitori")
          .send({ nome: "Forbidden", tipo: "altro" })
      ).status,
    ).toBe(403);
    expect(
      (
        await warehouse
          .get("/api/operativita/fornitori")
          .query({ contesto: "magazzino", areaOperativaId: areaIds[1] })
      ).status,
    ).toBe(403);
    expect(
      (
        await warehouse
          .get("/api/carico-pratiche")
          .query({ areaOperativaId: areaIds[0] })
      ).status,
    ).toBe(200);
  });

  it("Logistica dispone di prodotti/magazzini operativi e Turni senza area Magazzino/Sociale", async () => {
    const logistics = agent("Operatore Logistica");
    for (const resource of ["prodotti", "magazzini", "fornitori"])
      expect(
        (
          await logistics
            .get(`/api/operativita/${resource}`)
            .query({ contesto: "approvvigionamenti" })
        ).status,
      ).toBe(200);
    expect((await logistics.get("/api/prodotti")).status).toBe(403);
    expect((await logistics.get("/api/turni")).status).toBe(200);
    expect((await logistics.get("/api/fornitori")).status).toBe(200);
    expect(
      (await logistics.get("/api/report/magazzino-logistica").query(period))
        .status,
    ).toBe(200);
  });

  it("Emporio usa stampa operativa senza impostazioni amministrative e senza Magazzino", async () => {
    const emporio = agent("Emporio");
    const settings = await emporio
      .get("/api/operativita/stampa")
      .query({ contesto: "emporio" });
    expect(settings.status).toBe(200);
    expect(Object.keys(settings.body).sort()).toEqual([
      "dataAggiornamento",
      "footerBolla",
      "templateBolla",
    ]);
    expect((await emporio.get("/api/impostazioni-stampa")).status).toBe(403);
    expect((await emporio.get("/api/prodotti")).status).toBe(403);
    expect((await emporio.get("/api/magazzini")).status).toBe(403);
    expect(
      (await emporio.get("/api/report/emporio").query(period)).status,
    ).toBe(200);
  });

  it("Mensa conserva le sette viste e il confine Area, senza report di altre sorgenti", async () => {
    const mensa = agent("Operatore Mensa");
    for (const path of [
      "mense",
      "pasti",
      "abilitazioni",
      "trasferimenti",
      "consumi",
      "eccezioni",
      "report",
    ]) {
      const response = await mensa
        .get(`/api/mensa/${path}`)
        .query({ dal: "2026-10-22", al: "2026-10-22" });
      expect(response.status, `${path}: ${JSON.stringify(response.body)}`).toBe(
        200,
      );
    }
    expect((await mensa.get(`/api/mensa/mense/${mensaIds[1]}`)).status).toBe(
      403,
    );
    const otherReport = await mensa
      .get("/api/mensa/report")
      .query({ dal: "2026-10-22", al: "2026-10-22", mensaId: mensaIds[1] });
    expect(otherReport.status).toBe(200);
    expect(otherReport.body.totalePasti).toBe(0);
    expect((await mensa.get("/api/report/uds").query(period)).status).toBe(403);
    expect(roles.get("Operatore Mensa")!.grants).not.toContain(
      "mensa.meals.override",
    );
    expect(roles.get("Operatore Mensa")!.grants).not.toContain(
      "mensa.service.reopen",
    );
  });

  it("Volontario vede turni/consegne/MAPS della sua Area, senza mutazioni o dossier", async () => {
    const volunteer = agent("Volontario");
    expect((await volunteer.get("/api/turni")).status).toBe(200);
    const deliveries = await volunteer.get("/api/consegne");
    expect(deliveries.status).toBe(200);
    expect(
      deliveries.body.items.map((row: { id: number }) => row.id),
    ).toContain(deliveryIds[0]);
    expect(
      deliveries.body.items.map((row: { id: number }) => row.id),
    ).not.toContain(deliveryIds[1]);
    const maps = await volunteer.get("/api/maps/capabilities");
    expect(maps.status).toBe(200);
    expect(maps.body.layers.map((row: { code: string }) => row.code)).toEqual([
      "pacchi.consegne",
    ]);
    for (const path of [
      "beneficiari",
      "volontari",
      "mezzi",
      "fornitori",
      "dashboard/stats",
    ])
      expect((await volunteer.get(`/api/${path}`)).status, path).toBe(403);
    expect((await volunteer.put("/api/turni").send({})).status).toBe(403);
    expect((await volunteer.post("/api/consegne").send({})).status).toBe(403);
    for (const method of ["post", "patch", "delete"] as const)
      expect(
        (
          await volunteer[method](
            `/api/fornitori${method === "post" ? "" : `/${supplierIds[0]}`}`,
          ).send({})
        ).status,
      ).toBe(403);
  });

  it("Volontario scarica solo la bolla emessa della consegna dell'Area, senza dossier o mutazioni", async () => {
    const volunteer = agent("Volontario");
    const response = await volunteer.get(`/api/consegne/${deliveryIds[0]}/bolla-trasporto`);
    expect(response.status).toBe(200); expect(response.headers["cache-control"]).toContain("no-store");
    expect(response.body).toMatchObject({ id: bollaIds[0], consegnaId: deliveryIds[0], stato: "confermato", righe: [{ prodottoId: productId, quantita: 2 }] });
    expect(response.body).not.toHaveProperty("noteRicezione"); expect(response.body).not.toHaveProperty("motivoAnnullamento");
    expect(response.body.righe[0]).not.toHaveProperty("note");
    const listed = await volunteer.get("/api/consegne");
    expect(listed.body.items.find((row: { id: number }) => row.id === deliveryIds[0]).bollaId).toBe(bollaIds[0]);
    expect((await volunteer.get(`/api/consegne/${deliveryIds[1]}/bolla-trasporto`)).status).toBe(403);
    expect((await volunteer.get(`/api/bolle/${bollaIds[0]}`)).status).toBe(403);
    expect((await volunteer.get(`/api/richieste-magazzino/${requestIds[0]}`)).status).toBe(403);
    for (const method of ["patch", "delete"] as const) expect((await volunteer[method](`/api/bolle/${bollaIds[0]}`).send({})).status).toBe(403);
    expect((await volunteer.post(`/api/consegne/${deliveryIds[0]}/bolla-trasporto`).send({})).status).toBe(404);
    expect((await volunteer.get("/api/operativita/stampa").query({ contesto: "consegne" })).status).toBe(200);
    await db.update(bolleTable).set({ stato: "bozza" }).where(eq(bolleTable.id, bollaIds[0]));
    try { expect((await volunteer.get(`/api/consegne/${deliveryIds[0]}/bolla-trasporto`)).status).toBe(404); }
    finally { await db.update(bolleTable).set({ stato: "confermato" }).where(eq(bolleTable.id, bollaIds[0])); }
  });

  it("Custom readonly e multi-area non acquisiscono gestione o sorgenti estranee", async () => {
    expect((await agent("Custom readonly").get("/api/prodotti")).status).toBe(
      200,
    );
    expect(
      (await agent("Custom readonly").post("/api/prodotti").send({})).status,
    ).toBe(403);
    expect((await agent("Custom multi").get("/api/turni")).status).toBe(200);
    expect(
      (await agent("Custom multi").get("/api/report/uds").query(period)).status,
    ).toBe(200);
    expect((await agent("Custom multi").get("/api/beneficiari")).status).toBe(
      403,
    );
  });

  it("Generale non riceve indicatori, alert o movimenti dei servizi non concessi", async () => {
    const general = agent("Custom generale");
    const stats = await general.get("/api/dashboard/stats");
    expect(stats.status).toBe(200);
    expect(Object.keys(stats.body).length).toBeGreaterThan(0);
    expect(Object.values(stats.body).every((value) => value === 0)).toBe(true);
    for (const path of ["alerts", "movimenti-recenti"]) {
      const response = await general.get(`/api/dashboard/${path}`);
      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
    }
  });

  it("revoca da un'altra sessione è efficace alla richiesta successiva e al nuovo login", async () => {
    const role = roles.get("Operatore Logistica")!;
    const reduced = role.grants.filter(
      (grant) => !grant.startsWith("logistica.turni."),
    );
    try {
      expect(
        (
          await agent("Amministratore")
            .patch(`/api/ruoli/${role.id}`)
            .send({ permessi: reduced })
        ).status,
      ).toBe(200);
      expect(
        (await agent("Operatore Logistica").get("/api/turni")).status,
      ).toBe(403);
      expect(
        (await agent("Operatore Logistica").get("/api/auth/me")).body.permessi,
      ).not.toContain("logistica.turni.view");
      const another = request.agent(app);
      expect(
        (
          await another
            .post("/api/auth/login")
            .send({ username: role.username, password })
        ).status,
      ).toBe(200);
      expect((await another.get("/api/turni")).status).toBe(403);
      await seedRoles();
      expect(
        (await agent("Operatore Logistica").get("/api/turni")).status,
      ).toBe(403);
    } finally {
      await db
        .update(ruoliTable)
        .set({ permessi: role.grants })
        .where(eq(ruoliTable.id, role.id));
    }
  });

  it("modulo spento nega API/report/prepare e non riattiva il servizio al bootstrap", async () => {
    const [module] = await db
      .select()
      .from(moduliFunzionaliTable)
      .where(eq(moduliFunzionaliTable.codice, "UDS"));
    try {
      await db
        .update(ambienteModuliTable)
        .set({ attivo: false })
        .where(eq(ambienteModuliTable.moduloId, module.id));
      await ensureAmbienteModuli();
      for (const path of ["/uds/directory", "/report/uds"])
        expect(
          (
            await agent("Operatore UDS")
              .get("/api" + path)
              .query(period)
          ).status,
        ).toBe(403);
      expect(
        (
          await agent("Operatore UDS")
            .post("/api/report/prepare")
            .query({ section: "uds", ...period })
        ).status,
      ).toBe(403);
    } finally {
      await db
        .update(ambienteModuliTable)
        .set({ attivo: true })
        .where(eq(ambienteModuliTable.moduloId, module.id));
    }
  });

  it("Carichi/Lotti e archivi Logistica si spengono senza bloccare le letture condivise", async () => {
    const modules = await db.select().from(moduliFunzionaliTable);
    const toggle = async (code: string, active: boolean) => {
      const module = modules.find((row) => row.codice === code)!;
      await db
        .update(ambienteModuliTable)
        .set({ attivo: active })
        .where(eq(ambienteModuliTable.moduloId, module.id));
    };
    try {
      await toggle("CARICHI", false);
      expect(
        (
          await agent("Operatore Magazzino")
            .get("/api/carico-pratiche")
            .query({ areaOperativaId: areaIds[0] })
        ).status,
      ).toBe(403);
      expect(
        (await agent("Operatore Magazzino").get("/api/lotti")).status,
      ).toBe(200);
      await toggle("CARICHI", true);
      await toggle("LOTTI", false);
      expect(
        (
          await agent("Operatore Magazzino")
            .get("/api/carico-pratiche")
            .query({ areaOperativaId: areaIds[0] })
        ).status,
      ).toBe(403);
      const config = await agent("Operatore Magazzino").get(
        "/api/configurazione-ambiente",
      );
      const loads = config.body.moduli.find(
        (row: { codice: string }) => row.codice === "CARICHI",
      );
      expect(loads.attivo).toBe(false);
      expect(loads.configuratoAttivo).toBe(true);
      await toggle("LOTTI", true);
      await toggle("LOGISTICA", false);
      expect(
        (await agent("Operatore Logistica").get("/api/volontari")).status,
      ).toBe(403);
      expect(
        (
          await agent("Operatore Logistica")
            .get("/api/report/magazzino-logistica")
            .query(period)
        ).status,
      ).toBe(403);
      expect(
        (
          await agent("Operatore")
            .get("/api/operativita/volontari")
            .query({ contesto: "consegne" })
        ).status,
      ).toBe(200);
      for (const code of ["VOLONTARI", "MEZZI", "FORNITORI"])
        await toggle(code, false);
      for (const resource of ["volontari", "mezzi"])
        expect(
          (
            await agent("Operatore")
              .get(`/api/operativita/${resource}`)
              .query({ contesto: "consegne" })
          ).status,
        ).toBe(200);
      expect(
        (
          await agent("Operatore Magazzino")
            .get("/api/operativita/fornitori")
            .query({ contesto: "magazzino" })
        ).status,
      ).toBe(200);
    } finally {
      for (const code of [
        "CARICHI",
        "LOTTI",
        "LOGISTICA",
        "VOLONTARI",
        "MEZZI",
        "FORNITORI",
      ])
        await toggle(code, true);
    }
  });

  it("Amministratore e SuperAdmin restano distinti e il ruolo conserva chiavi persistite sconosciute", async () => {
    expect(
      (await agent("Amministratore").get("/api/super-admin/moduli")).status,
    ).toBe(403);
    expect(
      (await agent("SuperAdmin").get("/api/super-admin/moduli")).status,
    ).toBe(200);
    const role = roles.get("Custom readonly")!;
    await db
      .update(ruoliTable)
      .set({ permessi: [...role.grants, "legacy.persisted.key"] })
      .where(eq(ruoliTable.id, role.id));
    expect(
      (
        await agent("Amministratore")
          .patch(`/api/ruoli/${role.id}`)
          .send({ permessi: [...role.grants, "legacy.persisted.key"] })
      ).status,
    ).toBe(200);
    expect(
      (
        await agent("Amministratore")
          .patch(`/api/ruoli/${role.id}`)
          .send({ permessi: ["new.unknown.key"] })
      ).status,
    ).toBe(400);
    const saved = await agent("Amministratore").get(`/api/ruoli/${role.id}`);
    expect(saved.body.permessi).toContain("legacy.persisted.key");
  });
});
