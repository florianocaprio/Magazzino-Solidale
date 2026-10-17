import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  db,
  beneficiariTable,
  centriAscoltoTable,
  areeOperativeTable,
  emporioAbilitazioniTable,
  creditoSolidaleMovimentiTable,
  creditoRicaricheMensiliTable as runs,
  creditoRicaricheDestinatariTable as items,
} from "@workspace/db";
import { creditoIntero, CreditoInteroError } from "./creditoIntero";
import {
  appendCreditTx,
  requireCreditModulesTx,
  CreditoSaldoError,
} from "./creditoSaldo";
import { systemAuditContext } from "./auditEvent";
import { logger } from "./logger";

export function calendarioCredito(now: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  return {
    periodo: `${part("year")}-${part("month")}`,
    primoDelMese: part("day") === "01",
  };
}

/** Invocazione interna, mai esposta via HTTP. Il clock è iniettabile nei soli test.
 * Congelamento del gruppo e lavorazione per beneficiario sono durevoli e distinti. */
export async function preparaRicaricaMensile(now = new Date()) {
  // Recupero al primo avvio utile della sola mensilità corrente (Europe/Rome).
  // Il gruppo resta congelato: i successivi tick non aggiungono destinatari.
  const { periodo } = calendarioCredito(now);
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`credito-mensile:${periodo}`},0))`,
    );
    const [existing] = await tx
      .select()
      .from(runs)
      .where(eq(runs.periodo, periodo));
    if (existing) return;
    await requireCreditModulesTx(tx);
    await tx.insert(runs).values({ periodo, avviataAt: now });
    // Nessun destinatario viene aggiunto in una ripartenza o consultazione.
    await tx.execute(sql`insert into credito_ricariche_destinatari(periodo,beneficiario_id)
      select ${periodo}, id from beneficiari where credito_solidale_abilitato = true order by id`);
  });
}

export async function eseguiRicaricaMensile(now = new Date()) {
  // Un modulo spento impedisce nuovi avvii, ma non nasconde lavori già persistiti.
  try {
    await preparaRicaricaMensile(now);
  } catch (error) {
    if (!(error instanceof CreditoSaldoError)) throw error;
  }
  const jobs = await db
    .select()
    .from(runs)
    // Non recuperare automaticamente mensilità precedenti, neppure incompiute.
    .where(
      and(
        eq(runs.periodo, calendarioCredito(now).periodo),
        isNull(runs.completataAt),
      ),
    )
    .orderBy(runs.periodo);
  for (const job of jobs) {
    const candidates = await db
      .select({ id: items.id })
      .from(items)
      .where(
        and(
          eq(items.periodo, job.periodo),
          inArray(items.stato, ["pendente", "errore"]),
        ),
      )
      .orderBy(items.beneficiarioId);
    for (const candidate of candidates) {
      try {
        await db.transaction(async (tx) => {
          const [item] = await tx
            .select()
            .from(items)
            .where(
              and(
                eq(items.id, candidate.id),
                inArray(items.stato, ["pendente", "errore"]),
              ),
            )
            .for("update", { skipLocked: true });
          if (!item) return;
          const done = (
            stato: string,
            causa: string | null,
            movimentoId: number | null = null,
          ) =>
            tx
              .update(items)
              .set({ stato, causa, movimentoId, aggiornataAt: now })
              .where(eq(items.id, item.id));
          const [b] = await tx
            .select()
            .from(beneficiariTable)
            .where(eq(beneficiariTable.id, item.beneficiarioId))
            .for("update");
          // Anche una mensilità storica annullata/stornata resta già eseguita.
          const [previous] = await tx
            .select({ id: creditoSolidaleMovimentiTable.id })
            .from(creditoSolidaleMovimentiTable)
            .where(
              and(
                eq(creditoSolidaleMovimentiTable.beneficiarioId, b.id),
                eq(
                  creditoSolidaleMovimentiTable.tipoMovimento,
                  "ricarica_mensile",
                ),
                eq(
                  creditoSolidaleMovimentiTable.periodoRiferimento,
                  job.periodo,
                ),
              ),
            )
            .limit(1);
          if (previous) {
            await done("gia_elaborato", "mensilita_gia_eseguita", previous.id);
            return;
          }
          await requireCreditModulesTx(tx);
          if (
            !b.attivo ||
            !b.creditoSolidaleAbilitato ||
            b.creditoSolidaleStato !== "attivo"
          ) {
            await done("escluso", "beneficiario_credito_non_attivo");
            return;
          }
          const [right] = await tx
            .select()
            .from(emporioAbilitazioniTable)
            .where(
              and(
                eq(emporioAbilitazioniTable.beneficiarioId, b.id),
                eq(
                  emporioAbilitazioniTable.areaOperativaId,
                  b.areaOperativaId ?? -1,
                ),
              ),
            )
            .for("share");
          if (
            !right ||
            right.stato !== "attivo" ||
            right.areaOperativaId !== b.areaOperativaId ||
            right.dataEffetto > now
          ) {
            await done("escluso", "diritto_emporio_non_valido");
            return;
          }
          const [center] = await tx
            .select()
            .from(centriAscoltoTable)
            .where(eq(centriAscoltoTable.id, b.centroAscoltoId ?? -1))
            .for("share");
          const [area] = await tx
            .select()
            .from(areeOperativeTable)
            .where(eq(areeOperativeTable.id, b.areaOperativaId ?? -1))
            .for("share");
          if (
            !center?.attivo ||
            !area?.attivo ||
            center.areaOperativaId !== area.id
          ) {
            await done("escluso", "territorio_non_coerente");
            return;
          }
          let quota: number;
          try {
            quota = creditoIntero(b.creditoSolidaleMensileAssegnato);
            creditoIntero(b.creditoSolidaleSaldo);
          } catch (error) {
            if (!(error instanceof CreditoInteroError)) throw error;
            await done("escluso", "quota_o_saldo_non_conforme");
            return;
          }
          if (quota <= 0) {
            await done("escluso", "quota_non_assegnata");
            return;
          }
          const movement = await appendCreditTx(tx, {
            beneficiary: b,
            variazione: quota,
            tipo: "ricarica_mensile",
            periodo: job.periodo,
            motivo: "Ricarica mensile automatica",
            command: systemAuditContext({
              actorCode: "credito-mensile",
              operationKey: `credito.mensile:${b.id}:${job.periodo}`,
            }),
          });
          await done("elaborato", null, movement.id);
        });
      } catch {
        // La TX economica è già annullata. Non sovrascrivere il successo di un altro worker.
        await db
          .update(items)
          .set({
            stato: "errore",
            causa: "elaborazione_non_completata",
            aggiornataAt: now,
          })
          .where(
            and(
              eq(items.id, candidate.id),
              inArray(items.stato, ["pendente", "errore"]),
            ),
          );
        logger.warn(
          { destinatarioId: candidate.id, periodo: job.periodo },
          "Ricarica mensile da riprendere",
        );
      }
    }
    await db
      .update(runs)
      .set({ completataAt: now })
      .where(
        and(
          eq(runs.periodo, job.periodo),
          sql`not exists(select 1 from ${items} where ${items.periodo}=${job.periodo} and ${items.stato} in ('pendente','errore'))`,
        ),
      );
  }
}

export function scheduleMonthlyCredit() {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await eseguiRicaricaMensile();
    } catch {
      logger.error("Scheduler credito mensile: elaborazione non disponibile");
    } finally {
      running = false;
    }
  };
  void tick();
  const timer = setInterval(() => void tick(), 60_000);
  timer.unref();
  return () => clearInterval(timer);
}
