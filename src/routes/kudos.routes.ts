import { Router } from "express";
import * as ctrl from "../controllers/kudos.controller";
import { authenticate } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { asyncHandler } from "../middleware/error";
import { createKudosSchema, kudosQuerySchema } from "../schemas/kudos.schema";
import { idParam } from "../schemas/common.schema";

const router = Router();

router.use(authenticate);

// Team-wide, like /reports — any authenticated user may view and give kudos.
router.get("/", validate({ query: kudosQuerySchema }), asyncHandler(ctrl.listKudos));
router.post("/", validate({ body: createKudosSchema }), asyncHandler(ctrl.createKudos));
router.delete("/:id", validate({ params: idParam }), asyncHandler(ctrl.deleteKudos));

export default router;
