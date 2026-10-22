export const RBAC_UPDATE_VERSION = "BUG6_RBAC_1";
export type RoleConfiguration = {
  nome: string;
  aree: string[];
  permessi: string[];
  isAdmin: boolean;
};
export type PersistedRole = RoleConfiguration & { id: number };
export type RoleChange = {
  id: number;
  before: RoleConfiguration;
  after: RoleConfiguration;
};

export function roleConfiguration(role: RoleConfiguration): RoleConfiguration {
  return {
    nome: role.nome,
    aree: [...role.aree],
    permessi: [...role.permessi],
    isAdmin: role.isAdmin,
  };
}

export function sameRoleConfiguration(
  left: RoleConfiguration,
  right: RoleConfiguration,
): boolean {
  return (
    left.nome === right.nome &&
    left.isAdmin === right.isAdmin &&
    JSON.stringify([...left.aree].sort()) ===
      JSON.stringify([...right.aree].sort()) &&
    JSON.stringify([...left.permessi].sort()) ===
      JSON.stringify([...right.permessi].sort())
  );
}

/** A name is never enough: only an exact known legacy configuration is proposed.
 * Different/unknown grants or Areas are retained for explicit administrator review. */
export function planRoleReconciliation(
  rows: PersistedRole[],
  legacy: RoleConfiguration[],
  target: RoleConfiguration[],
) {
  const changes: RoleChange[] = [];
  const retained: { id: number; nome: string; reason: string }[] = [];
  for (const row of rows) {
    const previous = legacy.find((role) => sameRoleConfiguration(role, row));
    const next = previous && target.find((role) => role.nome === previous.nome);
    if (!next || sameRoleConfiguration(row, next)) {
      retained.push({
        id: row.id,
        nome: row.nome,
        reason: next
          ? "già allineato"
          : "custom o configurazione da verificare",
      });
    } else
      changes.push({
        id: row.id,
        before: roleConfiguration(row),
        after: roleConfiguration(next),
      });
  }
  return { version: RBAC_UPDATE_VERSION, changes, retained };
}
