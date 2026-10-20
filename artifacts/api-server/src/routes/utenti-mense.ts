import { Router } from "express";
import { db, utentiMenseTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAdmin } from "../middlewares/auth";
const router = Router();
router.use("/utenti/:utenteId/mense", requireAdmin);
router.get("/utenti/:utenteId/mense", async (req, res) => {
  const id = Number(req.params.utenteId);
  if (!Number.isSafeInteger(id) || id <= 0) {
    res.status(400).json({ error: "Utente non valido" });
    return;
  }
  res.json(
    await db
      .select()
      .from(utentiMenseTable)
      .where(eq(utentiMenseTable.utenteId, id))
      .orderBy(utentiMenseTable.mensaId),
  );
});
// Conserviamo le letture storiche; una vecchia interfaccia non può più
// creare autorizzazioni individuali che il modello per Area non utilizza.
router.put("/utenti/:utenteId/mense/:mensaId", (_req, res) => {
  res.status(410).json({
    error:
      "Le assegnazioni individuali Mensa sono dismesse. Usa ruolo e Area Operativa dell'utente.",
  });
});
export default router;
