import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { parseFseBeneficiariWorkbook } from "../src/lib/fseBeneficiari";

import { massivoFixture } from "./helpers/fse-massivo-workbook";

it("riconosce il Massivo XLSM, scarta foglio tecnico e righe modello, conserva la riga Excel e tutti i conteggi", () => {
  const parsed = parseFseBeneficiariWorkbook(massivoFixture());
  expect(parsed.formatoFile).toBe("MASSIVO");
  expect(parsed.header.errori).toEqual([]);
  expect(parsed.rows).toHaveLength(1);
  expect(parsed.rows[0]).toMatchObject({
    numeroRiga: 9,
    errori: [],
    row: {
      nome: "Persona",
      numeroComponenti: 3,
      donne: 2,
      uomini: 1,
      eta017: 1,
      eta1829: 0,
      eta3064: 1,
      eta65Plus: 1,
      anagrafica: {
        codiceFiscale: "RSSMRA90A01H501U",
        dataNascita: "1990-01-01",
        sesso: "F",
      },
    },
  });
});
it("rifiuta colonne mancanti/duplicate e date o conteggi incoerenti", () => {
  expect(
    parseFseBeneficiariWorkbook(
      massivoFixture({}, { missingHeader: true }),
    ).header.errori.join(" "),
  ).toContain("TotaleMinore18");
  expect(
    parseFseBeneficiariWorkbook(
      massivoFixture({}, { duplicateHeader: true }),
    ).header.errori.join(" "),
  ).toContain("duplicata");
  const errors = parseFseBeneficiariWorkbook(
    massivoFixture({
      DataDiNascitaReferenteNucleoFamiliare: "31/02/1990",
      TotaleMinore18: 0,
    }),
  ).rows[0].errori;
  expect(errors.join(" ")).toContain("nascita");
  expect(errors.join(" ")).toContain("fasce");
});
it("legge le date civili 1904 e non inventa il codice fiscale mancante", () => {
  const p = parseFseBeneficiariWorkbook(
    massivoFixture(
      { DataPresaInCarico: 0, CodiceFiscaleReferenteNucleo: null },
      { date1904: true },
    ),
  );
  expect(p.rows[0].row?.dataPresaInCarico).toBe("1904-01-01");
  expect(p.rows[0].row?.anagrafica?.codiceFiscale).toBeNull();
});
it.runIf(Boolean(process.env.FSE_MASSIVO_REAL_PATH))(
  "legge il Massivo reale con 117 date, 115 codici fiscali e 289 componenti, senza importare le 25.000 righe modello",
  () => {
    const p = parseFseBeneficiariWorkbook(
      readFileSync(process.env.FSE_MASSIVO_REAL_PATH!),
    );
    expect(p.header.errori).toEqual([]);
    expect(p.rows).toHaveLength(117);
    expect(p.rows.every((row) => row.errori.length === 0)).toBe(true);
    expect(
      p.rows.filter((row) => row.row?.anagrafica?.dataNascita),
    ).toHaveLength(117);
    expect(
      p.rows.filter((row) => row.row?.anagrafica?.codiceFiscale),
    ).toHaveLength(115);
    expect(
      ["eta017", "eta1829", "eta3064", "eta65Plus"].map((key) =>
        p.rows.reduce(
          (sum, row) =>
            sum + Number((row.row as unknown as Record<string, unknown>)[key]),
          0,
        ),
      ),
    ).toEqual([74, 20, 174, 21]);
  },
);
