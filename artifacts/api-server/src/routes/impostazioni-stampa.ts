import { Router, type IRouter } from "express";
import {
  ensureImpostazioniStampa,
  formatImpostazioniStampa,
  updateImpostazioniStampa,
  VALID_BOLLA_TEMPLATES,
  type BollaTemplate,
} from "../lib/impostazioniStampa";

const router: IRouter = Router();

router.get("/impostazioni-stampa", async (_req, res) => {
  const row = await ensureImpostazioniStampa();
  res.json(formatImpostazioniStampa(row));
});

router.put("/impostazioni-stampa", async (req, res) => {
  const { templateBolla, footerBolla } = req.body ?? {};
  if (
    templateBolla !== undefined &&
    !VALID_BOLLA_TEMPLATES.includes(templateBolla)
  ) {
    res.status(400).json({
      error: `templateBolla deve essere uno tra: ${VALID_BOLLA_TEMPLATES.join(", ")}`,
    });
    return;
  }
  const row = await updateImpostazioniStampa({
    ...(templateBolla !== undefined
      ? { templateBolla: templateBolla as BollaTemplate }
      : {}),
    ...(footerBolla !== undefined ? { footerBolla } : {}),
  });
  res.json(formatImpostazioniStampa(row));
});

export default router;
