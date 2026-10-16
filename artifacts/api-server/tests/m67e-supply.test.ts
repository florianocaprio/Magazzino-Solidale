import { afterAll, expect, it, vi } from "vitest";
import request from "supertest";
import { pool } from "@workspace/db";
import { m67aMensaFixture } from "./helpers/m67a-mensa-fixture";
import { httpListeners } from "./helpers/http-listeners";
import { createProdotto, newScope } from "./scope-helpers";
import { updateModuloAmbiente } from "../src/lib/configurazioneAmbiente";

vi.mock("../src/lib/orderEmail.js", () => ({
  sendApprovvigionamentoEmail: vi.fn(async () => undefined),
}));
const listeners = httpListeners({ diagnostics: "m67e-supply" });
afterAll(async () => {
  await listeners.close();
  await pool.end();
});

it.each([1.25, 1.000001])(
  "M67-25 real scoped session receives %s kg once under concurrent commands and replay; catalogue UOM and exact stock",
  async (quantity) => {
    const f = await m67aMensaFixture();
    await updateModuloAmbiente("APPROVVIGIONAMENTI", true, null);
    await pool.query("update ruoli set permessi=$1 where id=$2", [
      JSON.stringify([
        "approvvigionamenti.view",
        "approvvigionamenti.manage",
        "approvvigionamenti.receive",
      ]),
      f.users.warehouse.roleId,
    ]);
    const supplier = (
      await pool.query(
        "insert into fornitori(nome,tipo,area_operativa_id) values('M67E Synthetic supplier','azienda',$1) returning id",
        [f.area],
      )
    ).rows[0].id;
    const product = await createProdotto(newScope(), {
      unitaMisura: "kg",
      quantitaFrazionabile: true,
    });
    const { default: app } = await import("../src/app");
    const actor = request.agent(await listeners.open("app", () => app));
    expect(
      (await actor.post("/api/auth/login").send(f.users.warehouse)).status,
    ).toBe(200);
    const body = {
      areaOperativaId: f.area,
      fornitoreId: supplier,
      magazzinoId: f.origin,
      dataRichiesta: "2026-10-16",
      righe: [
        { prodottoId: product, quantitaRichiesta: quantity, unitaMisura: "kg" },
      ],
    };
    // Application area and grants are independent requirements. Keep the
    // warehouse-only denial, then model an explicitly authorized logistics role.
    expect(
      (await actor.post("/api/approvvigionamenti").send(body)).status,
    ).toBe(403);
    await pool.query("update ruoli set aree=$1 where id=$2", [
      JSON.stringify(["logistica"]),
      f.users.warehouse.roleId,
    ]);
    const created = await actor.post("/api/approvvigionamenti").send(body);
    expect(created.status, created.text).toBe(201);
    const snapshot = async () =>
      (
        await pool.query(
          "select (select coalesce(sum(quantita_residua),0)::text from lotti where prodotto_id=$1) stock,(select count(*)::int from movimenti where prodotto_id=$1) movements",
          [product],
        )
      ).rows[0];
    expect(await snapshot()).toEqual({ stock: "0", movements: 0 });
    const submitted = await actor
      .post(`/api/approvvigionamenti/${created.body.id}/sottometti`)
      .send({ versione: created.body.versione });
    expect(submitted.status, submitted.text).toBe(200);
    expect(await snapshot()).toEqual({ stock: "0", movements: 0 });
    const command = () =>
      actor
        .patch(`/api/approvvigionamenti/${created.body.id}`)
        .send({ versione: submitted.body.versione, stato: "completato" });
    const raced = await Promise.all([command(), command()]);
    expect(
      raced.map((r) => r.status).sort(),
      raced.map((r) => r.text).join("\n"),
    ).toEqual([200, 409]);
    expect(await snapshot()).toEqual({
      stock: quantity.toFixed(6),
      movements: 1,
    });
    expect((await command()).status).toBe(409);
    expect(await snapshot()).toEqual({
      stock: quantity.toFixed(6),
      movements: 1,
    });
    const detail = await actor.get(
      `/api/approvvigionamenti/${created.body.id}`,
    );
    expect(detail.status).toBe(200);
    expect(detail.body.stato).toBe("completato");
    expect(detail.body.righe).toMatchObject([
      { prodottoId: product, quantitaRicevuta: quantity, unitaMisura: "kg" },
    ]);
    expect(
      (
        await pool.query(
          "select tipo_movimento,unita_misura,quantita::text from movimenti where prodotto_id=$1",
          [product],
        )
      ).rows,
    ).toEqual([
      {
        tipo_movimento: "carico",
        unita_misura: "kg",
        quantita: quantity.toFixed(6),
      },
    ]);
  },
);
