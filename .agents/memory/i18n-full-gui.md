---
name: i18n full-GUI architecture
description: How the Magazzino Solidale frontend does whole-app translation (6 langs incl. Arabic RTL) and the reactivity pitfalls to avoid.
---

# Full-GUI i18n (magazzino-solidale)

The whole GUI (nav + all page bodies) is translated across 6 langs (it/es/en/fr/de/ar; ar is RTL),
not just the menu. Infra lives in the `src/lib/i18n/` DIRECTORY (not a single file):
- `index.ts` — init; merges every namespace into ONE i18next `translation` namespace; re-exports LANGUAGES/isRtl/applyDirection.
- `languages.ts` — LANGUAGES, STORAGE_KEY="ms-lang", isRtl, applyDirection, RTL=["ar"].
- `namespaces/base.ts` — shared `common.*` (save/cancel/delete/export/…) + `nav.*`.
- `namespaces/<page>.ts` — one per page, `export const <ns> = { it, es, en, fr, de, ar } as const`, identical key sets.
Components call `t("<ns>.<key>")` for page text, `t("common.<key>")` for shared chrome. Imports resolve via `@/lib/i18n`.

**Why a single `translation` namespace keyed per page:** lets any component pull any key without per-namespace
`useTranslation(ns)` wiring; adding a page = add a namespace file + register in `index.ts`.

## Reactivity pitfalls (these are the bugs that bite)
- **Never call `i18n.t()` at module scope** for strings that must change with language — module-scope runs ONCE at
  import time and won't re-resolve on language switch. Concretely: zod schema validation messages. Build the schema
  via a factory `makeXSchema(t)` and call it inside the component with `useMemo(() => makeXSchema(t), [t])`; derive the
  type via `z.infer<ReturnType<typeof makeXSchema>>`.
- `i18n.t()` INSIDE a render-invoked helper (e.g. a `getStatusBadge()` called during render) IS fine — the component
  re-renders on `languageChanged` (via `useTranslation`) and re-invokes the helper with the current language.
- **`main.tsx` must import `./lib/i18n` BEFORE `App`** — App eagerly imports pages whose module bodies may touch i18n;
  if i18n isn't initialized first, early `i18n.t()` resolves against an empty store.

## Intentionally NOT translated
PDF text baked via jspdf, and persisted data defaults (e.g. `trasportatoreNome` fallback "Ritiro presso il magazzino"
is a stored value, not UI chrome). Also never translate values sent to the backend, enum values, query keys, or API data.
