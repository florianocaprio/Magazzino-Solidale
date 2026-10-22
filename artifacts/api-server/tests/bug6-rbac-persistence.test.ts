import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db, pool, ruoliTable } from "@workspace/db";
import { seedRoles, STANDARD_ROLE_PROFILES } from "../src/lib/seedRoles";
import { LEGACY_ROLE_PROFILES } from "../src/lib/legacyRoleProfiles";

beforeAll(async () => {
  expect(process.env.NODE_ENV).toBe("test");
  expect(new URL(process.env.DATABASE_URL!).hostname).toBe("127.0.0.1");
  await seedRoles();
});
afterAll(async () => {
  await pool.end();
});

describe("BUG6 — persistenza e bonifica esplicita sul DB usa e getta", () => {
  it("CLI: un ruolo cambiato dopo il dry-run annulla l'intera transazione senza sovrascrivere la personalizzazione", async () => {
    const originals = await db
      .select()
      .from(ruoliTable)
      .where(inArray(ruoliTable.nome, ["Emporio", "Volontario"]));
    expect(originals).toHaveLength(2);
    const folder = mkdtempSync(join(tmpdir(), "bug6-conflict-"));
    const receipt = join(folder, "plan.json");
    const target = new URL(process.env.DATABASE_URL!);
    const cli = (mode: string) =>
      execFileSync(
        process.execPath,
        [
          "--import",
          "tsx",
          resolve("src/cli/rbac-roles.ts"),
          mode,
          "--host",
          target.hostname,
          "--database",
          target.pathname.slice(1),
          "--file",
          receipt,
        ],
        { encoding: "utf8", timeout: 30_000, stdio: "pipe" },
      );
    try {
      for (const original of originals) {
        const legacy = LEGACY_ROLE_PROFILES.find(
          (role) => role.nome === original.nome,
        )!;
        await db
          .update(ruoliTable)
          .set({ aree: legacy.aree, permessi: legacy.permessi })
          .where(eq(ruoliTable.id, original.id));
      }
      cli("dry-run");
      const plan = JSON.parse(readFileSync(receipt, "utf8"));
      const changes = plan.changes.filter((change: { id: number }) =>
        originals.some((role) => role.id === change.id),
      );
      expect(changes).toHaveLength(2);
      // Drift the last proposal: the preceding update must also roll back.
      const changed = changes.at(-1);
      const customized = [...changed.before.permessi, "custom.after-dry-run"];
      await db
        .update(ruoliTable)
        .set({ permessi: customized })
        .where(eq(ruoliTable.id, changed.id));
      expect(() => cli("apply")).toThrow(/changed after the dry-run/);
      for (const change of changes) {
        const [actual] = await db
          .select()
          .from(ruoliTable)
          .where(eq(ruoliTable.id, change.id));
        expect(actual.aree).toEqual(change.before.aree);
        expect(actual.permessi).toEqual(
          change.id === changed.id ? customized : change.before.permessi,
        );
      }
    } finally {
      for (const original of originals)
        await db
          .update(ruoliTable)
          .set({ aree: original.aree, permessi: original.permessi })
          .where(eq(ruoliTable.id, original.id));
      rmSync(folder, { recursive: true, force: true });
    }
  }, 120_000);

  it("due riavvii non ripristinano una revoca o le aree personalizzate di un ruolo standard", async () => {
    const [original] = await db
      .select()
      .from(ruoliTable)
      .where(eq(ruoliTable.nome, "Operatore Logistica"));
    const changed = {
      aree: ["logistica", "custom.persisted.area"],
      permessi: original.permessi.filter(
        (key) => key !== "logistica.turni.manage",
      ),
    };
    try {
      await db
        .update(ruoliTable)
        .set(changed)
        .where(eq(ruoliTable.id, original.id));
      await seedRoles();
      await seedRoles();
      const [after] = await db
        .select()
        .from(ruoliTable)
        .where(eq(ruoliTable.id, original.id));
      expect(after.aree).toEqual(changed.aree);
      expect(after.permessi).toEqual(changed.permessi);
      expect(after.id).toBe(original.id);
    } finally {
      await db
        .update(ruoliTable)
        .set({ aree: original.aree, permessi: original.permessi })
        .where(eq(ruoliTable.id, original.id));
    }
  });

  it("CLI: dry-run non scrive, apply/restore sono idempotenti e preservano ID", async () => {
    const [original] = await db
      .select()
      .from(ruoliTable)
      .where(eq(ruoliTable.nome, "Volontario"));
    const legacy = LEGACY_ROLE_PROFILES.find(
      (role) => role.nome === "Volontario",
    )!;
    const desired = STANDARD_ROLE_PROFILES.find(
      (role) => role.nome === "Volontario",
    )!;
    const folder = mkdtempSync(join(tmpdir(), "bug6-rbac-"));
    const receipt = join(folder, "plan.json");
    const target = new URL(process.env.DATABASE_URL!);
    const cli = (mode: string) =>
      execFileSync(
        process.execPath,
        [
          "--import",
          "tsx",
          resolve("src/cli/rbac-roles.ts"),
          mode,
          "--host",
          target.hostname,
          "--database",
          target.pathname.slice(1),
          "--file",
          receipt,
        ],
        { encoding: "utf8", timeout: 30_000 },
      );
    try {
      await db
        .update(ruoliTable)
        .set({ aree: legacy.aree, permessi: legacy.permessi })
        .where(eq(ruoliTable.id, original.id));
      expect(cli("dry-run")).toContain("Dry-run:");
      expect(statSync(receipt).mode & 0o777).toBe(0o600);
      const plan = JSON.parse(readFileSync(receipt, "utf8"));
      expect(plan.changes.map((row: { id: number }) => row.id)).toContain(
        original.id,
      );
      const [unchanged] = await db
        .select()
        .from(ruoliTable)
        .where(eq(ruoliTable.id, original.id));
      expect(unchanged.permessi).toEqual(legacy.permessi);
      expect(cli("apply")).toContain("apply completato");
      expect(cli("apply")).toContain("Nessuna variazione");
      const [updated] = await db
        .select()
        .from(ruoliTable)
        .where(eq(ruoliTable.id, original.id));
      expect(updated.aree).toEqual(desired.aree);
      expect(updated.permessi).toEqual(desired.permessi);
      expect(statSync(receipt + ".backup.json").mode & 0o777).toBe(0o600);
      expect(cli("restore")).toContain("restore completato");
      expect(cli("restore")).toContain("Nessuna variazione");
      const [restored] = await db
        .select()
        .from(ruoliTable)
        .where(eq(ruoliTable.id, original.id));
      expect(restored.permessi).toEqual(legacy.permessi);
      expect(restored.aree).toEqual(legacy.aree);
    } finally {
      await db
        .update(ruoliTable)
        .set({ aree: original.aree, permessi: original.permessi })
        .where(eq(ruoliTable.id, original.id));
      rmSync(folder, { recursive: true, force: true });
    }
  }, 120_000);
});
