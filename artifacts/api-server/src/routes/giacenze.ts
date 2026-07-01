import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { lottiTable, prodottiTable, magazziniTable } from "@workspace/db";
import { eq, and, gt, sum, count, min } from "drizzle-orm";
import {
  callerCentroId,
  callerCittaId,
  visibleMagazzinoIds,
  magazzinoScopeFilter,
} from "../lib/centroScope";
import {
  calcolaImpegnatoAttivoPerGiacenze,
  disponibilitaMagazzinoKey,
  parseDbNumber,
} from "../lib/disponibilitaMagazzino";

const router: IRouter = Router();

router.get("/giacenze", async (req, res) => {
  const { magazzinoId, sottoscortaOnly, fsePlusOnly } = req.query as Record<string, string>;

  const conditions = [gt(lottiTable.quantitaResidua, "0")];
  if (magazzinoId) conditions.push(eq(lottiTable.magazzinoId, parseInt(magazzinoId)));
  if (fsePlusOnly === "true") conditions.push(eq(lottiTable.fsePlus, true));
  const scope = magazzinoScopeFilter(lottiTable.magazzinoId, await visibleMagazzinoIds(callerCentroId(req), callerCittaId(req)));
  if (scope) conditions.push(scope);

  const rows = await db
    .select({
      prodottoId: prodottiTable.id,
      prodottoNome: prodottiTable.nome,
      prodottoCodice: prodottiTable.codice,
      tipoProdotto: prodottiTable.tipoProdotto,
      unitaMisura: prodottiTable.unitaMisura,
      scortaMinima: prodottiTable.scortaMinima,
      scortaConsigliata: prodottiTable.scortaConsigliata,
      magazzinoId: magazziniTable.id,
      magazzinoNome: magazziniTable.nome,
      quantitaTotale: sum(lottiTable.quantitaResidua),
      lottiAttivi: count(lottiTable.id),
      prossimaScadenza: min(lottiTable.dataScadenza),
    })
    .from(lottiTable)
    .innerJoin(prodottiTable, eq(lottiTable.prodottoId, prodottiTable.id))
    .innerJoin(magazziniTable, eq(lottiTable.magazzinoId, magazziniTable.id))
    .where(and(...conditions))
    .groupBy(prodottiTable.id, magazziniTable.id)
    .orderBy(prodottiTable.nome);

  const impegnatoByKey = await calcolaImpegnatoAttivoPerGiacenze(
    rows.map((r) => ({ prodottoId: r.prodottoId, magazzinoId: r.magazzinoId })),
  );

  const result = rows.map(r => {
    const giacenzaFisica = parseDbNumber(r.quantitaTotale);
    const impegnato = impegnatoByKey.get(disponibilitaMagazzinoKey(r.prodottoId, r.magazzinoId)) ?? 0;
    const sm = parseDbNumber(r.scortaMinima);
    return {
      prodottoId: r.prodottoId,
      prodottoNome: r.prodottoNome,
      prodottoCodice: r.prodottoCodice,
      tipoProdotto: r.tipoProdotto,
      unitaMisura: r.unitaMisura,
      magazzinoId: r.magazzinoId,
      magazzinoNome: r.magazzinoNome,
      quantitaTotale: giacenzaFisica,
      giacenzaFisica,
      impegnato,
      disponibileReale: giacenzaFisica - impegnato,
      scortaMinima: sm,
      scortaConsigliata: parseDbNumber(r.scortaConsigliata),
      sottoscorta: giacenzaFisica <= sm,
      lottiAttivi: Number(r.lottiAttivi),
      prossimaScadenza: r.prossimaScadenza ?? null,
    };
  });

  const filtered = sottoscortaOnly === "true" ? result.filter(r => r.sottoscorta) : result;
  res.json(filtered);
});

export default router;
