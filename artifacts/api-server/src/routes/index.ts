import { Router, type IRouter } from "express";
import healthRouter from "./health";
import dashboardRouter from "./dashboard";
import magazziniRouter from "./magazzini";
import prodottiRouter from "./prodotti";
import fornitoriRouter from "./fornitori";
import lottiRouter from "./lotti";
import carichiRouter from "./carichi";
import movimentiRouter from "./movimenti";
import giacenzeRouter from "./giacenze";
import preparazioneConsegneRouter from "./preparazione-consegne";
import volontariRouter from "./volontari";
import ruoliVolontariRouter from "./ruoli-volontari";
import tipiInterventoRouter from "./tipi-intervento";
import tipologieFornitoreRouter from "./tipologie-fornitore";
import mezziRouter from "./mezzi";
import areaOperativaRouter from "./aree-operative";
import zoneUdsRouter from "./zone-uds";
import udsRouter from "./uds";
import centriAscoltoRouter from "./centri-ascolto";
import beneficiariRouter from "./beneficiari";
import interventiRouter from "./interventi";
import consegneRouter from "./consegne";
import bolleRouter from "./bolle";
import trasferimentiRouter from "./trasferimenti";
import scarichiRouter from "./scarichi";
import approvvigionamentiRouter from "./approvvigionamenti";
import approvazioniLogisticaRouter from "./approvazioni-logistica";
import turniRouter from "./turni";
import impostazioniStampaRouter from "./impostazioni-stampa";
import impostazioniEmailRouter from "./impostazioni-email";
import impostazioniModuliRouter from "./impostazioni-moduli";
import configurazioneAmbienteRouter from "./configurazione-ambiente";
import superAdminRouter from "./super-admin";
import politicheCreditoSolidaleRouter from "./politiche-credito-solidale";
import creditoSolidaleRouter from "./credito-solidale";
import accessiEmporioRouter from "./accessi-emporio";
import cassaEmporioRouter from "./cassa-emporio";
import speseEmporioRouter from "./spese-emporio";
import reportIntegratoRouter from "./report-integrato";
import reportRouter from "./report";
import mensaRouter from "./mensa";
import ageaRouter from "./agea";
import fseRouter from "./fse";
import mapsRouter from "./maps";
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
router.use(carichiRouter);
router.use(movimentiRouter);
router.use(giacenzeRouter);
router.use(preparazioneConsegneRouter);
router.use(volontariRouter);
router.use(ruoliVolontariRouter);
router.use(tipiInterventoRouter);
router.use(tipologieFornitoreRouter);
router.use(mezziRouter);
router.use(areaOperativaRouter);
router.use(zoneUdsRouter);
router.use(udsRouter);
router.use(centriAscoltoRouter);
router.use(beneficiariRouter);
router.use(interventiRouter);
router.use(consegneRouter);
router.use(bolleRouter);
router.use(trasferimentiRouter);
router.use(scarichiRouter);
router.use(approvvigionamentiRouter);
router.use(approvazioniLogisticaRouter);
router.use(turniRouter);
router.use(impostazioniStampaRouter);
router.use(impostazioniEmailRouter);
router.use(impostazioniModuliRouter);
router.use(configurazioneAmbienteRouter);
router.use(superAdminRouter);
router.use(politicheCreditoSolidaleRouter);
router.use(creditoSolidaleRouter);
router.use(accessiEmporioRouter);
router.use(cassaEmporioRouter);
router.use(speseEmporioRouter);
router.use(reportIntegratoRouter);
router.use(reportRouter);
router.use(mensaRouter);
router.use(ageaRouter);
router.use(fseRouter);
router.use(mapsRouter);

// Admin-only management endpoints.
router.use(areeRouter);
router.use(ruoliRouter);
router.use(utentiRouter);

export default router;
