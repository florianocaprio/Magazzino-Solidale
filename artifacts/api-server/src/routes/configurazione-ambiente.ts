import { Router, type IRouter } from "express";
import { getConfigurazioneAmbientePubblica } from "../lib/configurazioneAmbiente";

const router: IRouter = Router();

router.get("/configurazione-ambiente", async (_req, res) => {
  res.json(await getConfigurazioneAmbientePubblica());
});

export default router;
