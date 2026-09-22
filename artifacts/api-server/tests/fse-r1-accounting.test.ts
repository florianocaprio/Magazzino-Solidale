/* @vitest-environment node */

import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { isCivilDate, isCivilYearMonth } from "../src/lib/civilDate";
import {
  accountingDisposition,
  accountingSign,
  signedInventoryValue,
  signedMovementSql,
} from "../src/lib/fseAccounting";

describe("Magazzino 2.0C-R1 — date civili e segno contabile", () => {
  it.each(["2026-02-29", "2026-04-31", "2026-13-01", "2026-00-10"])(
    "rifiuta la data civile impossibile %s",
    (value) => expect(isCivilDate(value)).toBe(false),
  );

  it("accetta date e mesi civili reali", () => {
    expect(isCivilDate("2028-02-29")).toBe(true);
    expect(isCivilYearMonth("2026-08")).toBe(true);
    expect(isCivilYearMonth("2026-00")).toBe(false);
  });

  it("distingue lo storno in base alla natura originale", () => {
    expect(
      accountingSign({
        naturaContabile: "STORNO",
        naturaOriginale: "DISTRIBUZIONE_FINALE",
      }),
    ).toBe(1);
    expect(
      accountingSign({
        naturaContabile: "STORNO",
        naturaOriginale: "CARICO",
      }),
    ).toBe(-1);
    expect(
      accountingDisposition({
        naturaContabile: "STORNO",
        naturaOriginale: "RESO",
      }),
    ).toBe("CORREZIONE_RESO");
  });

  it("conserva esattamente valori oltre 2^53 con sei decimali", () => {
    expect(
      signedInventoryValue("9007199254740993.123456", {
        naturaContabile: "DISTRIBUZIONE_FINALE",
      }),
    ).toBe("-9007199254740993.123456");
    expect(
      signedInventoryValue(null, { naturaContabile: "CARICO" }),
    ).toBeNull();
    expect(
      signedInventoryValue("0.000000", { naturaContabile: "CARICO" }),
    ).toBe("0.000000");
  });

  it("tratta CONSEGNA_ENTE come uscita fisica senza assimilarla alla distribuzione sociale", () => {
    expect(accountingSign({ naturaContabile: "CONSEGNA_ENTE" })).toBe(-1);
    expect(
      signedInventoryValue("4.000000", {
        naturaContabile: "CONSEGNA_ENTE",
      }),
    ).toBe("-4.000000");
    expect(
      signedInventoryValue("1.250000", {
        naturaContabile: "CONSEGNA_ENTE",
      }),
    ).toBe("-1.250000");
    expect(accountingDisposition({ naturaContabile: "CONSEGNA_ENTE" })).toBe(
      "TRACCIABILITA_INTERNA",
    );

    expect(
      accountingSign({
        naturaContabile: "STORNO",
        naturaOriginale: "CONSEGNA_ENTE",
      }),
    ).toBe(1);
    expect(
      signedInventoryValue("4.000000", {
        naturaContabile: "STORNO",
        naturaOriginale: "CONSEGNA_ENTE",
      }),
    ).toBe("4.000000");
    expect(
      accountingDisposition({
        naturaContabile: "STORNO",
        naturaOriginale: "CONSEGNA_ENTE",
      }),
    ).toBe("TRACCIABILITA_INTERNA");
  });

  it.each([
    "DISTRIBUZIONE_FINALE",
    "TRASFERIMENTO_INTERNO_USCITA",
    "RETTIFICA_NEGATIVA",
    "SCARTO",
    "RESO",
  ])("conserva il segno negativo della natura preesistente %s", (nature) => {
    expect(accountingSign({ naturaContabile: nature })).toBe(-1);
    expect(
      accountingSign({
        naturaContabile: "STORNO",
        naturaOriginale: nature,
      }),
    ).toBe(1);
  });

  it.each([
    "CARICO",
    "TRASFERIMENTO_INTERNO_ENTRATA",
    "RETTIFICA_POSITIVA",
    "SALDO_INIZIALE",
  ])("conserva il segno positivo della natura preesistente %s", (nature) => {
    expect(accountingSign({ naturaContabile: nature })).toBe(1);
    expect(
      accountingSign({
        naturaContabile: "STORNO",
        naturaOriginale: nature,
      }),
    ).toBe(-1);
  });

  it("propaga CONSEGNA_ENTE anche nel CASE SQL condiviso da report ed export", () => {
    const query = new PgDialect().sqlToQuery(
      sql`SELECT ${signedMovementSql(
        sql`quantity`,
        sql`nature`,
        sql`original_nature`,
      )} AS signed_quantity`,
    );

    expect(
      query.params.filter((value) => value === "CONSEGNA_ENTE"),
    ).toHaveLength(2);
    expect(query.sql).toContain("THEN -abs");
  });
});
