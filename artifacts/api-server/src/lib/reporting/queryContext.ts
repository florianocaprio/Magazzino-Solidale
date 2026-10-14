import { AsyncLocalStorage } from "node:async_hooks";
import { db, ambienteModuliTable, moduliFunzionaliTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { CONFIGURAZIONE_AMBIENTE_ID } from "../configurazioneAmbiente";

type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];
const context = new AsyncLocalStorage<Executor>();

/** All report queries, including source flags, share the prepared snapshot. */
export function reportExecutor(): Executor {
  return context.getStore() ?? db;
}
export function hasReportSnapshot(): boolean {
  return context.getStore() != null;
}
export function withReportExecutor<T>(
  executor: Executor,
  run: () => Promise<T>,
): Promise<T> {
  return context.run(executor, run);
}

/** Reporting must never initialize configuration as a side effect of a read. */
export async function isReportModuleActive(code: string): Promise<boolean> {
  const [row] = await reportExecutor()
    .select({ module: moduliFunzionaliTable, environment: ambienteModuliTable })
    .from(moduliFunzionaliTable)
    .leftJoin(
      ambienteModuliTable,
      and(
        eq(ambienteModuliTable.moduloId, moduliFunzionaliTable.id),
        eq(
          ambienteModuliTable.configurazioneAmbienteId,
          CONFIGURAZIONE_AMBIENTE_ID,
        ),
      ),
    )
    .where(eq(moduliFunzionaliTable.codice, code.trim().toUpperCase()));
  return row
    ? row.module.core || (row.environment?.attivo ?? row.module.attivoDefault)
    : false;
}
