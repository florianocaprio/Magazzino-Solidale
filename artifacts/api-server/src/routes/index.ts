import { Router, type IRouter } from "express";
import healthRouter from "./health";
import dashboardRouter from "./dashboard";
import magazziniRouter from "./magazzini";
import prodottiRouter from "./prodotti";
import fornitoriRouter from "./fornitori";
import lottiRouter from "./lotti";
import movimentiRouter from "./movimenti";
import giacenzeRouter from "./giacenze";
import preparazioneConsegneRouter from "./preparazione-consegne";
import volontariRouter from "./volontari";
import ruoliVolontariRouter from "./ruoli-volontari";
import tipiInterventoRouter from "./tipi-intervento";
import tipologieFornitoreRouter from "./tipologie-fornitore";
import mezziRouter from "./mezzi";
import cittaRouter from "./citta";
import zoneUdsRouter from "./zone-uds";
import centriAscoltoRouter from "./centri-ascolto";
import beneficiariRouter from "./beneficiari";
import interventiRouter from "./interventi";
import consegneRouter from "./consegne";
import bolleRouter from "./bolle";
import trasferimentiRouter from "./trasferimenti";
import scarichiRouter from "./scarichi";
import approvvigionamentiRouter from "./approvvigionamenti";
import turniRouter from "./turni";
import impostazioniStampaRouter from "./impostazioni-stampa";
import reportRouter from "./report";
import authRouter from "./auth";
import utentiRouter from "./utenti";
import ruoliRouter from "./ruoli";
import areeRouter from "./aree";
import {
  requireAuth,
  requirePasswordChange,
  areaGuard,
} from "../middlewares/auth";

const router: IRouter = Router();

// Public endpoints (no authentication required).
router.use(healthRouter);
router.use(authRouter);

// Everything below requires an authenticated session and respects role areas.
router.use(requireAuth);
// Force first-login password rotation before any business endpoint is reachable.
router.use(requirePasswordChange);
router.use(areaGuard);

router.use(dashboardRouter);
router.use(magazziniRouter);
router.use(prodottiRouter);
router.use(fornitoriRouter);
router.use(lottiRouter);
router.use(movimentiRouter);
router.use(giacenzeRouter);
router.use(preparazioneConsegneRouter);
router.use(volontariRouter);
router.use(ruoliVolontariRouter);
router.use(tipiInterventoRouter);
router.use(tipologieFornitoreRouter);
router.use(mezziRouter);
router.use(cittaRouter);
router.use(zoneUdsRouter);
router.use(centriAscoltoRouter);
router.use(beneficiariRouter);
router.use(interventiRouter);
router.use(consegneRouter);
router.use(bolleRouter);
router.use(trasferimentiRouter);
router.use(scarichiRouter);
router.use(approvvigionamentiRouter);
router.use(turniRouter);
router.use(impostazioniStampaRouter);
router.use(reportRouter);

// Admin-only management endpoints.
router.use(areeRouter);
router.use(ruoliRouter);
router.use(utentiRouter);

export default router;
