import { Router, type IRouter } from "express";
import { requireAuth, requireAdmin } from "../middlewares/auth";
import { ALL_AREAS } from "../lib/areas";
import { ALL_PERMISSIONS } from "../lib/permissions";

const router: IRouter = Router();

router.get("/aree", requireAuth, requireAdmin, (_req, res): void => {
  res.json(ALL_AREAS.map((a) => ({ key: a.key, label: a.label })));
});

router.get("/permessi", requireAuth, requireAdmin, (_req, res): void => {
  res.json(ALL_PERMISSIONS.map((item) => ({ ...item })));
});

export default router;
