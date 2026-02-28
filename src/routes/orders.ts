import { Router } from "express";
import {
  createRazorpayOrder,
  verifyPayment,
} from "../controllers/orderController";

const router = Router();
router.post("/create-razorpay-order", createRazorpayOrder);
router.post("/verify-payment", verifyPayment);
export default router;
