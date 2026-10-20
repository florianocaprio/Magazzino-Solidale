import * as XLSX from "xlsx";

export const FSE_MASSIVO_SHEET = "Configuratore file csv";
const columns = {
  "Nome Referente fascicolo": "NomeReferenteNucleoFamiliare",
  "Cognome Referente fascicolo": "CognomeReferenteNucleoFamiliare",
  "Codice fascicolo": "CodiceFascicolo",
  "Data di presa in carico": "DataPresaInCarico",
  "Tipologia di Attività": "TipologiaDiSupporto",
  "Stato attuale": "StatoFascicolo",
  Donne: "TotaleDonne",
  Uomini: "TotaleUomini",
  "Età<18": "TotaleMinore18",
  "Età 18-29": "Totale18-29",
  "Età 30-64": "Totale30-64",
  "Età>=65": "TotaleMaggioreUguale65",
  "Origine straniera e minoranze": "TotaleStranieriMinoranze",
  Disabili: "TotaleDisabili",
  "Cittadini di Paesi Terzi": "TotaleCittadiniPaesiTerzi",
  "Senzatetto o colpiti da esclusione abitativa": "TotaleSenzaTetto",
} as const;
const personalColumns = [
  "CodiceFiscaleReferenteNucleo",
  "DataDiNascitaReferenteNucleoFamiliare",
  "SessoReferenteNucleoFamiliare",
];
const normalize = (value: unknown) =>
  String(value ?? "")
    .trim()
    .toLowerCase();

/** Legge soltanto i dati dichiarati del foglio visibile. Macro, formule di
 * esportazione, foglio Dati e righe del modello prive di identità non sono importati. */
export function readFseMassivo(
  sheet: XLSX.WorkSheet,
  dateValue: (value: unknown) => string | null,
) {
  const positions = new Map<string, number>();
  const errori: string[] = [];
  const range = XLSX.utils.decode_range(sheet["!ref"] ?? "A1");
  for (let c = 0; c <= range.e.c; c++) {
    const heading = normalize(sheet[XLSX.utils.encode_cell({ r: 7, c })]?.v);
    if (!heading) continue;
    if (positions.has(heading))
      errori.push(`Colonna duplicata nel Massivo: ${heading}.`);
    positions.set(heading, c);
  }
  for (const name of [...Object.values(columns), ...personalColumns]) {
    if (!positions.has(normalize(name)))
      errori.push(`Colonna obbligatoria mancante nel Massivo: ${name}.`);
  }
  const rawRows: Array<Record<string, unknown>> = [];
  if (!errori.length)
    for (let r = 8; r <= range.e.r; r++) {
      const get = (name: string) =>
        sheet[XLSX.utils.encode_cell({ r, c: positions.get(normalize(name))! })]
          ?.v ?? null;
      if (
        ![
          "CodiceFascicolo",
          "NomeReferenteNucleoFamiliare",
          "CognomeReferenteNucleoFamiliare",
          ...personalColumns,
          "DataPresaInCarico",
        ].some((name) => get(name) != null && String(get(name)).trim() !== "")
      )
        continue;
      const row: Record<string, unknown> = Object.fromEntries(
        Object.entries(columns).map(([canonical, source]) => [
          canonical,
          get(source),
        ]),
      );
      row["Numero componenti fascicolo"] =
        Number(row.Donne) + Number(row.Uomini);
      const support = String(row["Tipologia di Attività"] ?? "").trim();
      row["Tipologia di Attività"] =
        support === "P" ? "Pacchi" : support === "D" ? "Domiciliare" : support;
      row["Data di presa in carico"] =
        dateValue(row["Data di presa in carico"]) ??
        row["Data di presa in carico"];
      const birth = get("DataDiNascitaReferenteNucleoFamiliare");
      row.__fseAnagrafica = {
        codiceFiscale:
          String(get("CodiceFiscaleReferenteNucleo") ?? "")
            .trim()
            .toUpperCase() || null,
        dataNascita:
          birth == null || birth === ""
            ? null
            : (dateValue(birth) ?? String(birth)),
        sesso:
          ({ donna: "F", uomo: "M", f: "F", m: "M" } as Record<string, string>)[
            normalize(get("SessoReferenteNucleoFamiliare"))
          ] ??
          (String(get("SessoReferenteNucleoFamiliare") ?? "").trim() || null),
      };
      row.__fseNumeroRiga = r + 1;
      rawRows.push(row);
      if (rawRows.length > 500) break;
    }
  return { rawRows, errori };
}
