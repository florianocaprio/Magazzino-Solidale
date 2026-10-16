// Read-only catalog comparison for M6.7 P2. No database connection or DDL.
// Physical differences remain in the inventory; only explicit, tested rules
// below may reconcile them. Unknown differences are blockers.
function enclosingParens(sql) {
  if (!sql.startsWith("(") || !sql.endsWith(")")) return false;
  let depth = 0;
  let quoted = false;
  for (let i = 0; i < sql.length; i++) {
    if (sql[i] === "'") {
      if (quoted && sql[i + 1] === "'") i++;
      else quoted = !quoted;
    } else if (!quoted) {
      if (sql[i] === "(") depth++;
      if (sql[i] === ")" && --depth === 0 && i !== sql.length - 1) return false;
    }
  }
  return depth === 0 && !quoted;
}

export function normalizeLiteralArrays(expression) {
  // pg_dump/restore distributes a varchar[] -> text[] cast over its constant
  // elements. Only literal arrays of these exact types are interchangeable.
  const normalize = (whole, body) => {
    const literal =
      /(?:\('((?:[^']|'')*)'::character varying\)::text|'((?:[^']|'')*)'::character varying|'((?:[^']|'')*)'::text)/gy;
    const values = [];
    let offset = 0;
    while (offset < body.length) {
      literal.lastIndex = offset;
      const match = literal.exec(body);
      if (!match) return whole;
      values.push(`'${match[1] ?? match[2] ?? match[3]}'::text`);
      offset = literal.lastIndex;
      if (offset === body.length) break;
      if (body.slice(offset, offset + 2) !== ", ") return whole;
      offset += 2;
    }
    return values.length ? `ARRAY[${values.join(", ")}]` : whole;
  };
  return expression
    .replace(/\(ARRAY\[([^\]]*)\]\)::text\[\]/g, normalize)
    .replace(/ARRAY\[([^\]]*)\]/g, normalize);
}

export function checkAtoms(expression) {
  let sql = normalizeLiteralArrays(expression.trim());
  while (enclosingParens(sql)) sql = sql.slice(1, -1).trim();
  let depth = 0;
  let quoted = false;
  const conjunctions = [];
  let hasDisjunction = false;
  for (let i = 0; i < sql.length; i++) {
    if (sql[i] === "'") {
      if (quoted && sql[i + 1] === "'") i++;
      else quoted = !quoted;
    } else if (!quoted) {
      if (sql[i] === "(") depth++;
      if (sql[i] === ")") depth--;
      if (depth === 0 && sql.slice(i, i + 4) === " OR ") hasDisjunction = true;
      if (depth === 0 && sql.slice(i, i + 5) === " AND ") conjunctions.push(i);
    }
  }
  if (!hasDisjunction && conjunctions.length) {
    const i = conjunctions[0];
    return [...checkAtoms(sql.slice(0, i)), ...checkAtoms(sql.slice(i + 5))];
  }
  return [sql];
}

const unique = (entries) => [...new Set(entries)].sort();
export const checkRules = (catalog) => {
  const rules = unique(
    catalog.constraints
      .filter((c) => c.type === "c")
      .flatMap((c) =>
        checkAtoms(c.expression).map((atom) => `${c.table_name}|${atom}`),
      ),
  );
  // The canonical meal enum admits only two nonblank values (or SQL NULL).
  // Its older nonblank CHECK is redundant, not missing protection. Do not
  // ignore a trim CHECK unless this exact stronger rule coexists locally.
  const canonicalMeal =
    "mensa_pasti|(tipo_servizio)::text = ANY (ARRAY['pranzo'::text, 'cena'::text])";
  return rules.includes(canonicalMeal)
    ? rules.filter(
        (rule) =>
          rule !== "mensa_pasti|length(TRIM(BOTH FROM tipo_servizio)) > 0",
      )
    : rules;
};

function indexRule(index) {
  let sql = index.definition.replace(
    /^CREATE (UNIQUE )?INDEX \S+ ON /,
    "CREATE $1INDEX ON ",
  );
  // PostgreSQL TRIM(BOTH FROM varchar) is btrim(varchar::text).
  if (index.name === "zone_uds_area_nome_attiva_unique")
    sql = sql.replace(
      "lower(TRIM(BOTH FROM nome))",
      "lower(btrim((nome)::text))",
    );
  // Standard UNIQUE indexes admit multiple NULLs. The historical partial
  // predicate excludes only these unconstrained keys (verified on PostgreSQL).
  if (
    index.name === "carichi_magazzino_idempotency_unique" &&
    index.unique &&
    !index.nulls_not_distinct
  )
    sql = sql.replace(" WHERE (idempotency_key IS NOT NULL)", "");
  // Only the two non-unique canonical history indexes differ in traversal
  // direction. This is physical planning, not a row/uniqueness invariant.
  if (
    !index.unique &&
    [
      "emissioni_registro_scope_owner_idx",
      "fse_fascicoli_snapshot_asof_idx",
    ].includes(index.name)
  )
    sql = sql.replaceAll(" DESC", "");
  return `${normalizeLiteralArrays(sql)}|nullsNotDistinct=${index.nulls_not_distinct}`;
}

function foreignRule(c) {
  // RESTRICT vs immediate NO ACTION is NOT erased: it is classified
  // separately and must be backed by the historical migration and probes.
  return `${c.table_name}|${c.definition.replace(/ NOT VALID$/, "")}|deferrable=${c.deferrable}|deferred=${c.deferred}`;
}

function effectiveForeignRules(catalog) {
  const constraints = catalog.constraints.filter((c) => c.type === "f");
  // A redundant immediate NO ACTION alias cannot relax an immediate RESTRICT
  // FK that is already enforced on the same columns/reference in this DB.
  // A lone NO ACTION never becomes RESTRICT via normalization.
  return unique(
    constraints
      .filter((c) => {
        if (c.deferrable || c.deferred || c.delete_action !== "a") return true;
        return !constraints.some(
          (other) =>
            !other.deferrable &&
            !other.deferred &&
            other.delete_action === "r" &&
            foreignRule(other).replace(" ON DELETE RESTRICT", "") ===
              foreignRule(c),
        );
      })
      .map(foreignRule),
  );
}

export function compareCatalogs(historical, fresh) {
  const difference = (a, b) => a.filter((v) => !new Set(b).has(v));
  const hc = checkRules(historical),
    fc = checkRules(fresh);
  const hi = unique(historical.indexes.map(indexRule)),
    fi = unique(fresh.indexes.map(indexRule));
  const hf = effectiveForeignRules(historical);
  const ff = effectiveForeignRules(fresh);
  const primary = (c) =>
    unique(
      c.constraints
        .filter((r) => r.type === "p")
        .map(
          (r) =>
            `${r.table_name}|${r.definition}|${r.deferrable}|${r.deferred}`,
        ),
    );
  const result = {
    checksMissingInFresh: difference(hc, fc),
    checksMissingInHistorical: difference(fc, hc),
    indexesOnlyHistorical: difference(hi, fi),
    indexesOnlyFresh: difference(fi, hi),
    foreignOnlyHistorical: difference(hf, ff),
    foreignOnlyFresh: difference(ff, hf),
    primaryOnlyHistorical: difference(primary(historical), primary(fresh)),
    primaryOnlyFresh: difference(primary(fresh), primary(historical)),
    unsafeIndexes: [...historical.indexes, ...fresh.indexes].filter(
      (i) => !i.valid || !i.ready,
    ),
  };
  return result;
}
