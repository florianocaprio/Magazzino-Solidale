type NavigationEntry = { key: string; url: string; groupKey: string };

export function navigationPath(location: string): string {
  return location.split(/[?#]/, 1)[0].replace(/\/+$/, "") || "/";
}

/** Resolve only entries already filtered by the caller's access and modules. */
export function currentNavigationItem<T extends NavigationEntry>(
  location: string,
  visible: readonly T[],
): T | undefined {
  const path = navigationPath(location);
  const exact = visible.find((item) => navigationPath(item.url) === path);
  if (exact) return exact;
  const nested = visible
    .filter(
      (item) =>
        item.url !== "/" &&
        item.url !== "/report" &&
        path.startsWith(`${navigationPath(item.url)}/`),
    )
    .sort((a, b) => b.url.length - a.url.length)[0];
  if (nested) return nested;
  if (path === "/report/magazzino-logistica" || path === "/report/magazzino") {
    const alternate = path === "/report/magazzino" ? "/report/magazzino-logistica" : "/report/magazzino";
    return visible.find((item) => item.url === alternate);
  }
  const context =
    path === "/lotti"
      ? "/carico-merce"
      : path === "/report-uds"
        ? "/report/uds"
        : /^\/bolle(?:\/|$)/.test(path)
          ? "/trasferimenti"
          : /^\/beneficiari\/\d+$/.test(path)
            ? "/uds/anagrafica"
            : undefined;
  return context ? visible.find((item) => item.url === context) : undefined;
}
