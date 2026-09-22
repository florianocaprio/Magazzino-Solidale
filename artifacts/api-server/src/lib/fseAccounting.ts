import { sql, type SQL } from "drizzle-orm";
import { InventoryDecimal } from "./inventoryDecimal";

const NEGATIVE_NATURES = [
  "DISTRIBUZIONE_FINALE",
  "CONSEGNA_ENTE",
  "TRASFERIMENTO_INTERNO_USCITA",
  "RETTIFICA_NEGATIVA",
  "SCARTO",
  "RESO",
] as const;

const NEGATIVE_NATURES_SET = new Set<string>(NEGATIVE_NATURES);
const NEGATIVE_NATURES_SQL = sql.join(
  NEGATIVE_NATURES.map((nature) => sql`${nature}`),
  sql`, `,
);

export type AccountingNatureInput = {
  naturaContabile: string;
  naturaOriginale?: string | null;
};

export function accountingSign(input: AccountingNatureInput): -1 | 1 {
  if (input.naturaContabile === "STORNO") {
    return NEGATIVE_NATURES_SET.has(input.naturaOriginale ?? "") ? 1 : -1;
  }
  return NEGATIVE_NATURES_SET.has(input.naturaContabile) ? -1 : 1;
}

export function signedInventoryValue(
  value: string | null,
  input: AccountingNatureInput,
): string | null {
  if (value == null) return null;
  const absolute = InventoryDecimal.parse(value, {
    allowNegative: true,
  }).abs();
  return accountingSign(input) < 0 && !absolute.isZero()
    ? `-${absolute.toDb()}`
    : absolute.toDb();
}

export function signedMovementSql(
  quantity: SQL,
  nature: SQL,
  originalNature: SQL,
): SQL {
  return sql`CASE
    WHEN ${nature} = 'STORNO'
      AND ${originalNature} IN (${NEGATIVE_NATURES_SQL})
      THEN abs(COALESCE(${quantity}::numeric, 0))
    WHEN ${nature} = 'STORNO'
      THEN -abs(COALESCE(${quantity}::numeric, 0))
    WHEN ${nature} IN (${NEGATIVE_NATURES_SQL})
      THEN -abs(COALESCE(${quantity}::numeric, 0))
    ELSE abs(COALESCE(${quantity}::numeric, 0))
  END`;
}

export function accountingDisposition(input: {
  naturaContabile: string;
  naturaOriginale?: string | null;
  origineCarico?: string | null;
}): string {
  const { naturaContabile, naturaOriginale, origineCarico } = input;
  if (naturaContabile === "STORNO") {
    if (naturaOriginale === "DISTRIBUZIONE_FINALE")
      return "CORREZIONE_DISTRIBUZIONE";
    if (naturaOriginale === "CONSEGNA_ENTE") return "TRACCIABILITA_INTERNA";
    if (naturaOriginale === "RESO") return "CORREZIONE_RESO";
    if (["SCARTO", "RETTIFICA_NEGATIVA"].includes(naturaOriginale ?? ""))
      return "CORREZIONE_MODIFICA_GIACENZA";
    if (["CARICO", "RETTIFICA_POSITIVA"].includes(naturaOriginale ?? ""))
      return "RETTIFICA_NEGATIVA_ORIGINALE";
    if ((naturaOriginale ?? "").startsWith("TRASFERIMENTO_INTERNO_"))
      return "SOLO_AUDIT_TRASFERIMENTO";
    return "CORREZIONE_DA_GESTIRE_MANUALMENTE";
  }
  if (naturaContabile === "SALDO_INIZIALE") return "ESCLUSO_SALDO_INIZIALE";
  if (naturaContabile.startsWith("TRASFERIMENTO_INTERNO_"))
    return "SOLO_AUDIT_TRASFERIMENTO";
  if (naturaContabile === "CARICO" && origineCarico === "AGEA_SIFEAD")
    return "GIA_PRESENTE_REGISTRO_ESTERNO";
  if (naturaContabile === "CARICO") return "CARICO_FSE_DA_VERIFICARE";
  if (naturaContabile === "RESO") return "RESO_OPC";
  if (
    ["RETTIFICA_POSITIVA", "RETTIFICA_NEGATIVA", "SCARTO"].includes(
      naturaContabile,
    )
  )
    return "MODIFICA_GIACENZA";
  if (naturaContabile === "DISTRIBUZIONE_FINALE") return "DA_RENDICONTARE_DDC";
  if (naturaContabile === "CONSEGNA_ENTE") return "TRACCIABILITA_INTERNA";
  return "TRACCIABILITA_INTERNA";
}

export function isAdministrativeDisposition(disposition: string): boolean {
  return [
    "DA_RENDICONTARE_DDC",
    "RESO_OPC",
    "MODIFICA_GIACENZA",
    "CORREZIONE_DISTRIBUZIONE",
    "CORREZIONE_RESO",
    "CORREZIONE_MODIFICA_GIACENZA",
    "RETTIFICA_NEGATIVA_ORIGINALE",
    "CORREZIONE_DA_GESTIRE_MANUALMENTE",
  ].includes(disposition);
}
