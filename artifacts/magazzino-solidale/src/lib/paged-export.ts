export async function loadAllPages<T>(
  fetchPage: (page: number, limit: number) => Promise<T[]>,
  limit = 100,
): Promise<T[]> {
  const all: T[] = [];
  for (let page = 1; ; page += 1) {
    const rows = await fetchPage(page, limit);
    all.push(...rows);
    if (rows.length < limit) return all;
  }
}
