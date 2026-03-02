import { Router } from "express";
import {
  createRazorpayOrder,
  verifyPayment,
  createUpiPaymentOrder,
} from "../controllers/orderController";

const router = Router();
router.post("/create-razorpay-order", createRazorpayOrder);
router.post("/verify-payment", verifyPayment);
router.post("/create-upi-payment", createUpiPaymentOrder);
export default router;
