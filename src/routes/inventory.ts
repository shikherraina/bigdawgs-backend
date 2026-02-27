import { Router } from "express";
import {
  getAllProducts,
  getByCategory,
  getProductBySlug,
  getFeaturedProducts,
} from "../controllers/inventoryController";

const router = Router();

router.get("/", getAllProducts);
router.get("/featured", getFeaturedProducts);
router.get("/:category", getByCategory);
router.get("/:category/:slug", getProductBySlug);

export default router;
