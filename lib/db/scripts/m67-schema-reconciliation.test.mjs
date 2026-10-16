import assert from "node:assert/strict";
import test from "node:test";
import { checkAtoms, compareCatalogs } from "./m67-schema-reconciliation.mjs";
const catalog = (constraints = [], indexes = []) => ({ constraints, indexes });
const check = (expression, name = "check") => ({
  table_name: "t",
  name,
  type: "c",
  expression,
});
const index = (definition, extra = {}) => ({
  name: "i",
  definition,
  valid: true,
  ready: true,
  unique: true,
  nulls_not_distinct: false,
  ...extra,
});

test("meal nonblank rule is redundant only with the exact canonical enum", () => {
  const nonblank = {
    ...check("length(TRIM(BOTH FROM tipo_servizio)) > 0"),
    table_name: "mensa_pasti",
  };
  const canonical = {
    ...nonblank,
    expression:
      "(tipo_servizio)::text = ANY (ARRAY['pranzo'::text, 'cena'::text])",
  };
  assert.deepEqual(
    compareCatalogs(catalog([canonical, nonblank]), catalog([canonical]))
      .checksMissingInFresh,
    [],
  );
  assert.equal(
    compareCatalogs(catalog([nonblank]), catalog()).checksMissingInFresh.length,
    1,
  );
});

test("CHECK conjunction equals separate checks, including SQL unknown", () => {
  const r = compareCatalogs(
    catalog([check("((a >= 0) AND (b >= 0))")]),
    catalog([check("(a >= 0)"), check("(b >= 0)")]),
  );
  assert.deepEqual(r.checksMissingInFresh, []);
  assert.deepEqual(r.checksMissingInHistorical, []);
});
test("does not split OR or AND inside quoted literals", () => {
  assert.deepEqual(checkAtoms("((a = 'a AND b') OR (b = 'c'' AND d'))"), [
    "(a = 'a AND b') OR (b = 'c'' AND d')",
  ]);
});
test("does not distribute conjunction across a top-level OR", () => {
  assert.deepEqual(checkAtoms("a OR b AND c"), ["a OR b AND c"]);
});
test("constant varchar array casts survive dump/restore", () => {
  assert.deepEqual(
    checkAtoms(
      "x = ANY ((ARRAY['a'::character varying, 'b'::character varying])::text[])",
    ),
    checkAtoms(
      "x = ANY (ARRAY[('a'::character varying)::text, ('b'::character varying)::text])",
    ),
  );
});
test("array content and non-literal expressions are not discarded", () => {
  assert.notDeepEqual(
    checkAtoms("x = ANY (ARRAY['a'::character varying])"),
    checkAtoms("x = ANY (ARRAY['b'::character varying])"),
  );
  assert.deepEqual(checkAtoms("x = ANY (ARRAY[fn()])"), [
    "x = ANY (ARRAY[fn()])",
  ]);
});
test("missing nonnegative disability check remains blocking", () => {
  assert.equal(
    compareCatalogs(
      catalog([check("a >= 0")]),
      catalog([check("(a >= 0) AND (disability >= 0)")]),
    ).checksMissingInHistorical.length,
    1,
  );
});
test("changed numeric bound is not normalized", () => {
  const r = compareCatalogs(
    catalog([check("a >= 0")]),
    catalog([check("a >= -1")]),
  );
  assert.equal(r.checksMissingInHistorical.length, 1);
  assert.equal(r.checksMissingInFresh.length, 1);
});
test("index names do not change uniqueness", () => {
  assert.deepEqual(
    compareCatalogs(
      catalog(
        [],
        [index("CREATE UNIQUE INDEX a ON public.t USING btree (id)")],
      ),
      catalog(
        [],
        [index("CREATE UNIQUE INDEX b ON public.t USING btree (id)")],
      ),
    ).indexesOnlyHistorical,
    [],
  );
});
test("missing unique index remains blocking", () => {
  assert.equal(
    compareCatalogs(
      catalog(
        [],
        [index("CREATE UNIQUE INDEX a ON public.t USING btree (id)")],
      ),
      catalog(),
    ).indexesOnlyHistorical.length,
    1,
  );
});
test("unknown partial predicate is not ignored", () => {
  assert.equal(
    compareCatalogs(
      catalog(
        [],
        [
          index(
            "CREATE UNIQUE INDEX a ON public.t USING btree (id) WHERE active",
          ),
        ],
      ),
      catalog(
        [],
        [index("CREATE UNIQUE INDEX a ON public.t USING btree (id)")],
      ),
    ).indexesOnlyHistorical.length,
    1,
  );
});
test("invalid index is always blocking", () => {
  assert.equal(
    compareCatalogs(
      catalog(
        [],
        [
          index("CREATE INDEX a ON public.t USING btree (id)", {
            valid: false,
          }),
        ],
      ),
      catalog(),
    ).unsafeIndexes.length,
    1,
  );
});
test("FK action and deferrability remain visible", () => {
  const fk = {
    table_name: "t",
    name: "f",
    type: "f",
    definition: "FOREIGN KEY (id) REFERENCES p(id)",
    deferrable: false,
    deferred: false,
  };
  const r = compareCatalogs(
    catalog([{ ...fk, definition: fk.definition + " ON DELETE RESTRICT" }]),
    catalog([fk]),
  );
  assert.equal(r.foreignOnlyHistorical.length, 1);
  assert.equal(r.foreignOnlyFresh.length, 1);
});
test("only a coexisting strict FK can dominate a redundant immediate alias", () => {
  const fk = {
    table_name: "t",
    name: "f",
    type: "f",
    definition: "FOREIGN KEY (id) REFERENCES p(id)",
    deferrable: false,
    deferred: false,
    delete_action: "a",
  };
  const strict = {
    ...fk,
    definition: fk.definition + " ON DELETE RESTRICT",
    delete_action: "r",
  };
  assert.deepEqual(
    compareCatalogs(catalog([strict]), catalog([fk, strict])).foreignOnlyFresh,
    [],
  );
  assert.equal(
    compareCatalogs(catalog([strict]), catalog([fk])).foreignOnlyFresh.length,
    1,
  );
});
