import { sql, type SQL } from "drizzle-orm";

export type PhysicalMovement = {
  tipoMovimento: string;
  tipoDettaglio: string;
};

/** The physical sign belongs to the movement, never to its accounting nature. */
export function movementPhysicalEffect(
  movement: PhysicalMovement,
  original?: PhysicalMovement | null,
): -1 | 0 | 1 {
  switch (movement.tipoMovimento) {
    case "esito":
      return 0;
    case "carico":
    case "rettifica_positiva":
    case "rientro":
      return 1;
    case "scarico":
    case "rettifica_negativa":
      return -1;
    case "trasferimento":
      return movement.tipoDettaglio === "entrata" ? 1 : -1;
    case "storno": {
      if (!original) throw new Error("Movimento origine dello storno assente");
      const sign = movementPhysicalEffect(original);
      return sign === 0 ? 0 : sign === 1 ? -1 : 1;
    }
    default:
      throw new Error(
        `Tipo movimento fisico sconosciuto: ${movement.tipoMovimento}`,
      );
  }
}

/** SQL projection matching movementPhysicalEffect for the movimenti ledger. */
export function signedPhysicalMovementSql(
  quantity: SQL,
  movementType: SQL,
  detailType: SQL,
  originalMovementType: SQL,
  originalDetailType: SQL,
): SQL {
  return sql`CASE
    WHEN ${movementType} = 'esito' THEN 0
    WHEN ${movementType} IN ('carico', 'rettifica_positiva', 'rientro') THEN abs(COALESCE(${quantity}::numeric, 0))
    WHEN ${movementType} IN ('scarico', 'rettifica_negativa') THEN -abs(COALESCE(${quantity}::numeric, 0))
    WHEN ${movementType} = 'trasferimento' AND ${detailType} = 'entrata' THEN abs(COALESCE(${quantity}::numeric, 0))
    WHEN ${movementType} = 'trasferimento' THEN -abs(COALESCE(${quantity}::numeric, 0))
    WHEN ${movementType} = 'storno' AND ${originalMovementType} = 'esito' THEN 0
    WHEN ${movementType} = 'storno' AND ${originalMovementType} IN ('carico', 'rettifica_positiva', 'rientro') THEN -abs(COALESCE(${quantity}::numeric, 0))
    WHEN ${movementType} = 'storno' AND ${originalMovementType} = 'trasferimento' AND ${originalDetailType} = 'entrata' THEN -abs(COALESCE(${quantity}::numeric, 0))
    WHEN ${movementType} = 'storno' THEN abs(COALESCE(${quantity}::numeric, 0))
    ELSE 0 END`;
}
