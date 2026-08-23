import { sql, type SQL } from "drizzle-orm";
import { InventoryDecimal } from "./inventoryDecimal";

const NEGATIVE_NATURES = new Set([
  "DISTRIBUZIONE_FINALE",
  "TRASFERIMENTO_INTERNO_USCITA",
  "RETTIFICA_NEGATIVA",
  "SCARTO",
  "RESO",
]);

export type AccountingNatureInput = {
  naturaContabile: string;
  naturaOriginale?: string | null;
};

export function accountingSign(input: AccountingNatureInput): -1 | 1 {
  if (input.naturaContabile === "STORNO") {
    return NEGATIVE_NATURES.has(input.naturaOriginale ?? "") ? 1 : -1;
  }
  return NEGATIVE_NATURES.has(input.naturaContabile) ? -1 : 1;
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
      AND ${originalNature} IN ('DISTRIBUZIONE_FINALE', 'TRASFERIMENTO_INTERNO_USCITA', 'RETTIFICA_NEGATIVA', 'SCARTO', 'RESO')
      THEN abs(COALESCE(${quantity}::numeric, 0))
    WHEN ${nature} = 'STORNO'
      THEN -abs(COALESCE(${quantity}::numeric, 0))
    WHEN ${nature} IN ('DISTRIBUZIONE_FINALE', 'TRASFERIMENTO_INTERNO_USCITA', 'RETTIFICA_NEGATIVA', 'SCARTO', 'RESO')
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
  if (naturaContabile === "RESO") return "RESO_OPC";
  if (
    ["RETTIFICA_POSITIVA", "RETTIFICA_NEGATIVA", "SCARTO"].includes(
      naturaContabile,
    )
  )
    return "MODIFICA_GIACENZA";
  if (naturaContabile === "DISTRIBUZIONE_FINALE") return "DA_RENDICONTARE_DDC";
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
