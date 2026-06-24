import { sql } from "drizzle-orm";
import { db, beneficiariTable } from "@workspace/db";
import { logger } from "./logger";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Automatically lowers the assistance priority to "bassa" for any beneficiary
 * whose registration happened more than two years ago and whose priority is
 * still higher than "bassa". Registration date is `data_presa_in_carico` when
 * present, otherwise the record creation timestamp. Idempotent and safe to run
 * repeatedly.
 */
export async function downgradeStalePriorities(): Promise<void> {
  const result = await db
    .update(beneficiariTable)
    .set({ priorita: "bassa", dataAggiornamento: new Date() })
    .where(
      sql`COALESCE(${beneficiariTable.dataPresaInCarico}::timestamp, ${beneficiariTable.dataCreazione}) <= now() - interval '2 years' AND ${beneficiariTable.priorita} <> 'bassa'`,
    )
    .returning({ id: beneficiariTable.id });

  if (result.length > 0) {
    logger.info(
      { count: result.length },
      "Auto-downgraded beneficiary priorities to 'bassa' after 2 years",
    );
  }
}

/**
 * Runs the downgrade once at startup and then daily. Returns the interval timer
 * (unref'd so it never keeps the process alive on its own).
 */
export function schedulePriorityDowngrade(): NodeJS.Timeout {
  downgradeStalePriorities().catch((err) => {
    logger.error({ err }, "Failed to run priority downgrade at startup");
  });

  const timer = setInterval(() => {
    downgradeStalePriorities().catch((err) => {
      logger.error({ err }, "Failed to run scheduled priority downgrade");
    });
  }, DAY_MS);

  timer.unref();
  return timer;
}
