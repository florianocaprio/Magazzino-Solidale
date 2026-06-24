import { Router, type IRouter } from "express";
import { requireAuth, requireAdmin } from "../middlewares/auth";
import { ALL_AREAS } from "../lib/areas";

const router: IRouter = Router();

router.get("/aree", requireAuth, requireAdmin, (_req, res): void => {
  res.json(ALL_AREAS.map((a) => ({ key: a.key, label: a.label })));
});

export default router;
