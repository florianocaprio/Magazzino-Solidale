import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import {
  RBAC_UPDATE_VERSION,
  sameRoleConfiguration,
  planRoleReconciliation,
} from "../lib/roleReconciliation";

/** Explicit maintenance only; never imported by startup or run by a migration.
 * No credentials in the receipt. Requires the target host/database twice. */
async function main() {
  const [mode, ...args] = process.argv.slice(2);
  const option = (name: string) => args[args.indexOf(name) + 1];
  if (
    !["dry-run", "apply", "restore"].includes(mode) ||
    !args.includes("--host") ||
    !args.includes("--database") ||
    !args.includes("--file")
  )
    throw new Error(
      "Usage: rbac-roles.ts dry-run|apply|restore --host HOST --database DB --file ABSOLUTE_RECEIPT",
    );
  const url = new URL(process.env.DATABASE_URL ?? "");
  const target = {
    host: url.hostname,
    port: url.port || "5432",
    database: decodeURIComponent(url.pathname.slice(1)),
  };
  if (
    target.host !== option("--host") ||
    target.database !== option("--database")
  )
    throw new Error("Database destination differs from explicit target");
  const file = resolve(option("--file"));
  const { db, pool, ruoliTable, auditConfigurazioniTable } =
    await import("@workspace/db");
  try {
    const { STANDARD_ROLE_PROFILES } = await import("../lib/seedRoles");
    const { LEGACY_ROLE_PROFILES } = await import("../lib/legacyRoleProfiles");
    if (mode === "dry-run") {
      const rows = await db.select().from(ruoliTable).orderBy(ruoliTable.id);
      const receipt = {
        ...planRoleReconciliation(
          rows,
          LEGACY_ROLE_PROFILES,
          STANDARD_ROLE_PROFILES,
        ),
        target,
        createdAt: new Date().toISOString(),
      };
      await writeFile(file, JSON.stringify(receipt, null, 2), {
        mode: 0o600,
        flag: "wx",
      });
      console.log(
        `Dry-run: ${receipt.changes.length} proposte; ${receipt.retained.length} ruoli conservati. Ricevuta privata: ${file}`,
      );
      return;
    }
    const receipt = JSON.parse(await readFile(file, "utf8")) as ReturnType<
      typeof planRoleReconciliation
    > & { target: typeof target };
    if (
      receipt.version !== RBAC_UPDATE_VERSION ||
      JSON.stringify(receipt.target) !== JSON.stringify(target)
    )
      throw new Error("Receipt version/destination mismatch");
    // Revalidate proposals against known profiles: an edited receipt is not a role editor.
    for (const change of receipt.changes) {
      if (
        !Number.isSafeInteger(change.id) ||
        !LEGACY_ROLE_PROFILES.some((role) =>
          sameRoleConfiguration(role, change.before),
        ) ||
        !STANDARD_ROLE_PROFILES.some((role) =>
          sameRoleConfiguration(role, change.after),
        ) ||
        change.before.nome !== change.after.nome
      )
        throw new Error("Invalid or edited reconciliation proposal");
    }
    const backup =
      file + (mode === "apply" ? ".backup.json" : ".restore-backup.json");
    const before = await db.select().from(ruoliTable).orderBy(ruoliTable.id);
    if (
      receipt.changes.every((change) => {
        const current = before.find((role) => role.id === change.id);
        return (
          current &&
          sameRoleConfiguration(
            current,
            mode === "apply" ? change.after : change.before,
          )
        );
      })
    ) {
      console.log(
        "Nessuna variazione necessaria: aggiornamento già applicato/ripristinato.",
      );
      return;
    }
    await writeFile(
      backup,
      JSON.stringify(
        {
          version: RBAC_UPDATE_VERSION,
          target,
          roles: before.filter((role) =>
            receipt.changes.some((change) => change.id === role.id),
          ),
          createdAt: new Date().toISOString(),
        },
        null,
        2,
      ),
      { mode: 0o600, flag: "wx" },
    );
    await db.transaction(async (tx) => {
      for (const change of receipt.changes) {
        const expected = mode === "apply" ? change.before : change.after;
        const next = mode === "apply" ? change.after : change.before;
        const [current] = await tx
          .select()
          .from(ruoliTable)
          .where(eq(ruoliTable.id, change.id))
          .for("update");
        if (!current) throw new Error(`Role ${change.id} no longer exists`);
        if (sameRoleConfiguration(current, next)) continue;
        if (!sameRoleConfiguration(current, expected))
          throw new Error(
            `Role ${change.id} changed after the dry-run; no update applied`,
          );
        await tx
          .update(ruoliTable)
          .set({ aree: next.aree, permessi: next.permessi })
          .where(eq(ruoliTable.id, current.id));
        await tx
          .insert(auditConfigurazioniTable)
          .values({
            area: "rbac",
            chiave: `${RBAC_UPDATE_VERSION}:${current.id}`,
            azione:
              mode === "apply" ? "riallineamento_ruolo" : "ripristino_ruolo",
            valorePrecedente: expected,
            valoreNuovo: next,
            note: "Manutenzione esplicita; ID, descrizione e assegnazioni conservati",
          });
      }
    });
    console.log(`${mode} completato; backup mirato privato: ${backup}`);
  } finally {
    await pool.end();
  }
}
main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : "RBAC maintenance failed",
  );
  process.exitCode = 1;
});
