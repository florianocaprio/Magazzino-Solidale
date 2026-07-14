import { pathToFileURL } from "node:url";
import { db, pool, ruoliTable, utentiTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { initializeBaseData } from "../lib/baseData";
import {
  resetDemoWarehouseData,
  resetOperationalEnvironment,
  resetWarehouseData,
  seedDemoWarehouseData,
} from "../lib/environmentData";
import { SUPER_ADMIN_ROLE_NAME } from "../lib/seedRoles";

type Command =
  | "seed-base"
  | "seed-demo-magazzino"
  | "reset-demo-magazzino"
  | "reset-magazzino"
  | "reset-ambiente";

const CONFIRMATIONS: Partial<Record<Command, string>> = {
  "reset-demo-magazzino": "RESET MAGAZZINO DEMO",
  "reset-magazzino": "RESET MAGAZZINO",
  "reset-ambiente": "RESET AMBIENTE",
};

function usage(): string {
  return [
    "Uso:",
    "  pnpm --filter @workspace/api-server environment:data seed-base",
    "  pnpm --filter @workspace/api-server environment:data seed-demo-magazzino --super-admin=<username>",
    '  pnpm --filter @workspace/api-server environment:data reset-demo-magazzino --super-admin=<username> --confirm="RESET MAGAZZINO DEMO"',
    '  pnpm --filter @workspace/api-server environment:data reset-magazzino --super-admin=<username> --backup-confirmed --confirm="RESET MAGAZZINO"',
    '  pnpm --filter @workspace/api-server environment:data reset-ambiente --super-admin=<username> --backup-confirmed --confirm="RESET AMBIENTE"',
  ].join("\n");
}

function parseOptions(args: string[]): Map<string, string | true> {
  const options = new Map<string, string | true>();
  for (const arg of args) {
    if (!arg.startsWith("--")) {
      throw new Error(`Argomento non riconosciuto: ${arg}`);
    }
    const separator = arg.indexOf("=");
    if (separator === -1) {
      options.set(arg.slice(2), true);
    } else {
      options.set(arg.slice(2, separator), arg.slice(separator + 1));
    }
  }
  return options;
}

function optionString(
  options: Map<string, string | true>,
  name: string,
): string | undefined {
  const value = options.get(name);
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function validateOptions(
  options: Map<string, string | true>,
  allowed: string[],
): void {
  const unknown = [...options.keys()].filter((name) => !allowed.includes(name));
  if (unknown.length > 0) {
    throw new Error(`Opzioni non riconosciute: ${unknown.join(", ")}.`);
  }
}

async function requireSuperAdmin(
  username: string | undefined,
): Promise<number> {
  if (!username) {
    throw new Error("Specificare --super-admin=<username>.");
  }

  const [actor] = await db
    .select({
      id: utentiTable.id,
      isSuperAdmin: utentiTable.isSuperAdmin,
      roleName: ruoliTable.nome,
    })
    .from(utentiTable)
    .leftJoin(ruoliTable, eq(utentiTable.ruoloId, ruoliTable.id))
    .where(
      and(eq(utentiTable.username, username), eq(utentiTable.attivo, true)),
    )
    .limit(1);

  if (
    !actor ||
    (!actor.isSuperAdmin && actor.roleName !== SUPER_ADMIN_ROLE_NAME)
  ) {
    throw new Error(
      `L'utente attivo "${username}" non ha privilegi Super Admin.`,
    );
  }
  return actor.id;
}

function requireConfirmation(
  command: Command,
  options: Map<string, string | true>,
): void {
  const expected = CONFIRMATIONS[command];
  if (!expected) return;

  if (optionString(options, "confirm") !== expected) {
    throw new Error(`Conferma non valida. Usare --confirm="${expected}".`);
  }
  if (
    (command === "reset-magazzino" || command === "reset-ambiente") &&
    options.get("backup-confirmed") !== true
  ) {
    throw new Error(
      "Reset annullato: verificare prima il backup e aggiungere --backup-confirmed.",
    );
  }
}

export async function runEnvironmentDataCli(args: string[]): Promise<unknown> {
  const [rawCommand, ...rawOptions] = args;
  const commands: Command[] = [
    "seed-base",
    "seed-demo-magazzino",
    "reset-demo-magazzino",
    "reset-magazzino",
    "reset-ambiente",
  ];
  if (!commands.includes(rawCommand as Command)) {
    throw new Error(`Comando mancante o non valido.\n${usage()}`);
  }

  const command = rawCommand as Command;
  const options = parseOptions(rawOptions);
  if (command === "seed-base") {
    if (options.size > 0) {
      throw new Error("seed-base non accetta opzioni.");
    }
    await initializeBaseData();
    return { baseDataInitialized: true };
  }

  validateOptions(
    options,
    command === "seed-demo-magazzino"
      ? ["super-admin"]
      : command === "reset-demo-magazzino"
        ? ["super-admin", "confirm"]
        : ["super-admin", "confirm", "backup-confirmed"],
  );

  const actorUserId = await requireSuperAdmin(
    optionString(options, "super-admin"),
  );
  requireConfirmation(command, options);

  switch (command) {
    case "seed-demo-magazzino":
      return seedDemoWarehouseData(actorUserId);
    case "reset-demo-magazzino":
      return resetDemoWarehouseData(actorUserId);
    case "reset-magazzino":
      return resetWarehouseData(actorUserId);
    case "reset-ambiente":
      return resetOperationalEnvironment(actorUserId);
    default:
      throw new Error(`Comando non gestito: ${command satisfies never}`);
  }
}

async function main(): Promise<void> {
  const result = await runEnvironmentDataCli(process.argv.slice(2));
  console.log(JSON.stringify(result, null, 2));
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main()
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await pool.end();
    });
}
