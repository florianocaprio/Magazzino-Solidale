import { db, utentiTable, cittaTable } from "@workspace/db";
import { eq } from "drizzle-orm";

/**
 * One-off maintenance: regenerate every operator matricola in the new format
 *   <InitialNome><InitialCognome><yy>-<SIGLA>-<NNNNNN>
 * where yy = 2-digit year of insertion (dataCreazione), SIGLA = città sigla (or
 * first 2 letters of the città name as a fallback, "OO" for global users), and
 * NNNNNN = random 6-digit number. On a collision the first digit becomes a
 * letter (A, B, C, ...). Idempotent only in shape (numbers are random).
 */
function cittaSigla(sigla: string | null, nome: string | null): string {
  const s = (sigla ?? "").trim().toUpperCase();
  if (s.length >= 2) return s.slice(0, 2);
  const fromName = (nome ?? "").replace(/[^A-Za-z]/g, "").toUpperCase();
  return (fromName.slice(0, 2) || "XX").padEnd(2, "X");
}

function buildMatricola(
  nome: string,
  cognome: string | null,
  yy: string,
  sigla: string,
  tail: string,
): string {
  const initials = `${(nome ?? "").trim().charAt(0)}${(cognome ?? "").trim().charAt(0)}`.toUpperCase();
  return `${initials}${yy}-${sigla}-${tail}`;
}

async function main() {
  const citta = await db
    .select({ id: cittaTable.id, sigla: cittaTable.sigla, nome: cittaTable.nome })
    .from(cittaTable);
  const cittaMap = new Map(citta.map((c) => [c.id, c]));

  const utenti = await db
    .select({
      id: utentiTable.id,
      nome: utentiTable.nome,
      cognome: utentiTable.cognome,
      cittaId: utentiTable.cittaId,
      dataCreazione: utentiTable.dataCreazione,
    })
    .from(utentiTable)
    .orderBy(utentiTable.id);

  const seen = new Set<string>();
  let updated = 0;
  for (const u of utenti) {
    const yy = String(new Date(u.dataCreazione).getFullYear()).slice(-2);
    const c = u.cittaId != null ? cittaMap.get(u.cittaId) : undefined;
    const sigla = u.cittaId != null ? cittaSigla(c?.sigla ?? null, c?.nome ?? null) : "OO";

    let matricola = "";
    for (let i = 0; i < 100 && !matricola; i++) {
      const num = String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");
      let cand = buildMatricola(u.nome, u.cognome, yy, sigla, num);
      if (!seen.has(cand)) {
        matricola = cand;
        break;
      }
      for (let a = 0; a < 26; a++) {
        cand = buildMatricola(u.nome, u.cognome, yy, sigla, String.fromCharCode(65 + a) + num.slice(1));
        if (!seen.has(cand)) {
          matricola = cand;
          break;
        }
      }
    }
    if (!matricola) {
      matricola = buildMatricola(u.nome, u.cognome, yy, sigla, String(Date.now()).slice(-6));
    }

    seen.add(matricola);
    await db.update(utentiTable).set({ matricola }).where(eq(utentiTable.id, u.id));
    updated++;
    console.log(`#${u.id} ${u.nome} ${u.cognome ?? ""} -> ${matricola}`);
  }

  console.log(`\nBonifica completata: ${updated} matricole rigenerate.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
