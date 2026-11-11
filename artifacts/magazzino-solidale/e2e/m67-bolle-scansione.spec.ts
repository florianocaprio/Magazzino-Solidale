import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import QRCode from "qrcode";
import { m67aMensaFixture } from "../../api-server/tests/helpers/m67a-mensa-fixture";
import { updateModuloAmbiente } from "../../api-server/src/lib/configurazioneAmbiente";
import {
  createBeneficiario,
  createCentroRec,
  newScope,
} from "../../api-server/tests/scope-helpers";
import { pool } from "../../../lib/db/src/index";
import { selectOption } from "./helpers";

test.afterAll(async () => {
  await pool.end();
});

test("Bolle: tessera da lettore e fotocamera, ricerca prodotto con giacenze ancora in caricamento", async ({
  page,
}) => {
  const fixture = await m67aMensaFixture();
  for (const code of ["BOLLE", "CENTRO_ASCOLTO", "BARCODE"])
    await updateModuloAmbiente(code, true, null);
  const user = fixture.users.warehouse;
  await pool.query("update ruoli set permessi=$1 where id=$2", [
    JSON.stringify(["magazzino.view", "bolle.view", "bolle.manage"]),
    user.roleId,
  ]);
  const scope = newScope();
  const centre = await createCentroRec(scope, {
    areaOperativaId: fixture.area,
  });
  const person = await createBeneficiario(scope, centre.id, {
    areaOperativaId: fixture.area,
  });
  const cardCode = `MS-${randomUUID()}`;
  await pool.query(
    "insert into tessere_beneficiari (beneficiario_id, codice) values ($1, $2)",
    [person, cardCode],
  );
  const { nome, cognome } = (
    await pool.query("select nome, cognome from beneficiari where id=$1", [
      person,
    ])
  ).rows[0];
  const warehouse = (
    await pool.query("select nome from magazzini where id=$1", [fixture.origin])
  ).rows[0].nome;
  const barcodeBody = `234${String(fixture.product).padStart(9, "0")}`;
  const checksum = [...barcodeBody].reduce(
    (sum, digit, index) => sum + Number(digit) * (index % 2 ? 3 : 1),
    0,
  );
  const barcode = `${barcodeBody}${(10 - (checksum % 10)) % 10}`;
  const product = (
    await pool.query(
      "update prodotti set codice_barre=$1 where id=$2 returning nome, codice",
      [barcode, fixture.product],
    )
  ).rows[0];

  // Feed a synthetic camera frame to the real browser decoder.
  await page.addInitScript(
    (qr) => {
      navigator.mediaDevices.getUserMedia = async () => {
        const image = new Image();
        image.src = qr;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 400;
        const context = canvas.getContext("2d")!;
        const stream = canvas.captureStream(10);
        const track = stream.getVideoTracks()[0];
        const draw = () => {
          if (track.readyState === "ended") return;
          context.drawImage(image, 0, 0, 400, 400);
          requestAnimationFrame(draw);
        };
        draw();
        return stream;
      };
    },
    await QRCode.toDataURL(cardCode, { width: 400 }),
  );

  await page.goto("/login");
  await page.getByLabel(/username|nome utente/i).fill(user.username);
  await page.getByLabel(/^password$/i).fill(user.password);
  await page.getByRole("button", { name: /accedi|login/i }).click();
  await expect(page).not.toHaveURL(/\/login(?:[?#]|$)/);
  await page.goto("/bolle");
  await page.getByRole("button", { name: "Nuovo", exact: true }).click();
  await page.getByRole("button", { name: /^Nuova Bolla/ }).click();
  const draft = page.getByRole("dialog", { name: "Nuova Bolla di Consegna" });
  const cardField = draft.getByRole("textbox", {
    name: "Scansiona codice tessera",
  });
  const camera = draft.getByRole("button", { name: "Scansiona", exact: true });
  await expect(camera).toBeDisabled();
  await selectOption(
    page,
    draft.getByRole("combobox", { name: "Centro di Ascolto (filtro)" }),
    centre.nome,
  );
  await expect(cardField).toBeFocused();
  await expect(camera).toBeEnabled();

  const waitForCard = () =>
    page.waitForResponse(
      (response) =>
        response.url().endsWith("/bolle/beneficiari-candidati/tessera") &&
        response.request().method() === "POST",
    );
  const usbLookup = waitForCard();
  await page.keyboard.insertText(` ${cardCode} `);
  await page.keyboard.press("Enter");
  const usb = await usbLookup;
  expect(usb.status(), await usb.text()).toBe(200);
  expect((await usb.json()).id).toBe(person);
  await expect(
    draft.getByText(`${cognome} ${nome}`, { exact: true }),
  ).toBeVisible();

  const cameraLookup = waitForCard();
  await camera.click();
  const scanned = await cameraLookup;
  expect(scanned.status(), await scanned.text()).toBe(200);
  expect((await scanned.json()).id).toBe(person);
  await expect(
    page.getByRole("dialog", { name: "Scansiona codice a barre" }),
  ).toHaveCount(0);
  await selectOption(
    page,
    draft.getByRole("combobox", { name: "Magazzino di Uscita" }),
    warehouse,
  );
  const created = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/bolle") &&
      response.request().method() === "POST",
  );
  await draft.getByRole("button", { name: "Crea Bolla", exact: true }).click();
  const bolla = await created;
  expect(bolla.status(), await bolla.text()).toBe(201);
  const { id } = await bolla.json();

  const stockGate = Promise.withResolvers<void>();
  await page.route(/\/api\/giacenze\?/, async (route) => {
    await stockGate.promise;
    await route.continue();
  });
  const add = page.getByRole("dialog", {
    name: "Aggiungi Prodotto alla Bolla",
    exact: true,
  });
  const codeField = add.getByRole("textbox", {
    name: "Scansiona codice a barre prodotto",
  });
  try {
    await page
      .getByRole("button", { name: "Aggiungi prodotto", exact: true })
      .click();
    await expect(codeField).toBeFocused();
    await page.keyboard.insertText(product.codice);
    await add.getByRole("button", { name: "Cerca", exact: true }).click();
    await expect(add.getByRole("status")).toBeVisible();
  } finally {
    stockGate.resolve();
  }
  const selection = add.getByRole("combobox", {
    name: "Prodotto disponibile in magazzino",
  });
  await expect(selection).toContainText(product.nome);
  await codeField.fill(barcode);
  await codeField.press("Enter");
  await expect(codeField).toHaveValue("");
  await expect(selection).toContainText(product.nome);
  await add.getByRole("spinbutton", { name: "Quantità" }).fill("2");
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/bolle/${id}/righe`) &&
      response.request().method() === "POST",
  );
  await add.getByRole("button", { name: "Aggiungi", exact: true }).click();
  expect((await saved).status()).toBe(201);
  await expect(codeField).toBeFocused();
});
