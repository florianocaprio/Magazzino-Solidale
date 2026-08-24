import { Router, type IRouter } from "express";
import { requireAuth, requireAdmin } from "../middlewares/auth";
import { ALL_AREAS } from "../lib/areas";
import { ALL_PERMISSIONS, AREA_PERMISSION_MAP } from "../lib/permissions";

const router: IRouter = Router();

router.get("/aree", requireAuth, requireAdmin, (_req, res): void => {
  res.json(
    ALL_AREAS.map((area) => ({
      key: area.key,
      label: area.label,
      permessi: [...AREA_PERMISSION_MAP[area.key]],
    })),
  );
});

router.get("/permessi", requireAuth, requireAdmin, (_req, res): void => {
  res.json(ALL_PERMISSIONS.map((item) => ({ ...item })));
});

export default router;
