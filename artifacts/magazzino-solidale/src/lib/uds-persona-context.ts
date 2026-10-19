export function udsPersonPath(id: number, returnPath = "/uds/anagrafica") {
  const query = new URLSearchParams({
    ritorno: udsDirectoryReturnPath(returnPath),
  });
  return `/uds/anagrafica/${id}?${query}`;
}
export function udsDirectoryReturnPath(value: string | null | undefined) {
  if (!value) return "/uds/anagrafica";
  try {
    const url = new URL(value, "http://local.invalid");
    return url.origin === "http://local.invalid" &&
      url.pathname === "/uds/anagrafica"
      ? url.pathname + url.search
      : "/uds/anagrafica";
  } catch {
    return "/uds/anagrafica";
  }
}
