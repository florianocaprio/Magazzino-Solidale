import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { m67aMensaFixture } from "../../api-server/tests/helpers/m67a-mensa-fixture";
import { pool } from "../../../lib/db/src/index";
import { selectOption } from "./helpers";

test.afterAll(async () => {
  await pool.end();
});
test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus)
    await info.attach("synthetic-dom", {
      body: await page.locator("body").ariaSnapshot(),
      contentType: "text/plain",
    });
});

for (const change of ["Mensa", "Tipo servizio", "Area Operativa"] as const) {
  test(`M67-26 postazione: late positive verification after changing ${change} cannot enable a meal`, async ({
    page,
  }) => {
    const f = await m67aMensaFixture();
    const other =
      change === "Area Operativa" ? await m67aMensaFixture() : undefined;
    const actor = other ? f.users.admin : f.users.receiver;
    if (other)
      await pool.query("update utenti set area_operativa_id=null where id=$1", [
        actor.id,
      ]);
    else {
      await pool.query("update ruoli set permessi=$1 where id=$2", [
        JSON.stringify([
          "mensa.view",
          "mensa.access.scan",
          "mensa.meals.create",
        ]),
        actor.roleId,
      ]);
      await pool.query(
        "insert into utenti_mense(utente_id,mensa_id,assegnata_da) values($1,$2,$1)",
        [actor.id, f.canteens[1].id],
      );
    }
    const card = `P4-${randomUUID().replaceAll("-", "").slice(0, 16)}`;
    const person = (
      await pool.query(
        "insert into beneficiari(codice,nome,cognome,area_operativa_id,attivo) values($1,'Synthetic','Late context',$2,true) returning id",
        [card, f.area],
      )
    ).rows[0];
    await pool.query(
      "insert into tessere_beneficiari(beneficiario_id,codice,created_by) values($1,$2,$3)",
      [person.id, card, actor.id],
    );
    await pool.query(
      "insert into mensa_abilitazioni(beneficiario_id,mensa_id,data_inizio,stato,created_by) values($1,$2,'2020-01-01','attiva',$3)",
      [person.id, f.canteens[0].id, actor.id],
    );
    await page.goto("/login");
    await page.getByLabel(/username|nome utente/i).fill(actor.username);
    await page.getByLabel(/^password$/i).fill(actor.password);
    await page.getByRole("button", { name: /accedi|login/i }).click();
    await expect(page).toHaveURL(/\/$/);
    await page.goto("/mensa/postazione");
    if (other) {
      const area = (
        await pool.query("select nome from aree_operative where id=$1", [
          f.area,
        ])
      ).rows[0];
      await selectOption(
        page,
        page.getByRole("combobox", { name: "Area Operativa", exact: true }),
        area.nome,
      );
    }
    await selectOption(
      page,
      page.getByRole("combobox", { name: "Mensa", exact: true }),
      f.canteens[0].nome,
    );
    let release!: () => void, captured!: () => void, delivered!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      captured = resolve;
    });
    const finished = new Promise<void>((resolve) => {
      delivered = resolve;
    });
    let verificationId: number | undefined;
    let meals = 0;
    page.on("request", (request) => {
      if (
        new URL(request.url()).pathname === "/api/mensa/pasti" &&
        request.method() === "POST"
      )
        meals++;
    });
    await page.route("**/api/mensa/accessi/verifica", async (route) => {
      const response = await route.fetch();
      expect(response.status(), await response.text()).toBe(201);
      const result = await response.json();
      expect(result.esito).not.toBe("negato");
      verificationId = result.id;
      captured();
      await barrier;
      try {
        await route.fulfill({ response });
      } finally {
        delivered();
      }
    });
    try {
      await page.locator("#mensa-scan").fill(card);
      await page
        .getByRole("button", { name: "Verifica accesso", exact: true })
        .click();
      await started;
      const target = other
        ? (
            await pool.query("select nome from aree_operative where id=$1", [
              other.area,
            ])
          ).rows[0].nome
        : change === "Mensa"
          ? f.canteens[1].nome
          : "Cena";
      await selectOption(
        page,
        page.getByRole("combobox", { name: change, exact: true }),
        target,
      );
      await page
        .getByRole("alertdialog")
        .getByRole("button", { name: "Scarta modifiche", exact: true })
        .click();
      await expect(
        page.getByRole("combobox", { name: change, exact: true }),
      ).toContainText(target);
      release();
      await finished;
      await expect(
        page.getByRole("button", { name: "Registra pasto", exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("status").filter({ hasText: /accesso consentito/i }),
      ).toHaveCount(0);
      expect(meals).toBe(0);
      expect(
        (
          await pool.query(
            "select count(*)::int n from mensa_pasti where beneficiario_id=$1",
            [person.id],
          )
        ).rows[0].n,
      ).toBe(0);
      expect(
        (
          await pool.query(
            "select mensa_id,tipo_servizio from mensa_accessi where id=$1",
            [verificationId],
          )
        ).rows,
      ).toEqual([{ mensa_id: f.canteens[0].id, tipo_servizio: "pranzo" }]);
    } finally {
      release();
      await page.unrouteAll({ behavior: "wait" });
    }
  });
}
