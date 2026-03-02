import { Router } from "express";
import {
  createUpiPayment,
  verifyUpiPayment,
  getPaymentStatus,
  manualVerifyUpiPayment,
  approveByEmail,
  rejectByEmail,
  debugPayments,
} from "../controllers/upiController";

const router = Router();

// Create UPI payment with QR code
router.post("/create-payment", createUpiPayment);

// Verify UPI payment
router.post("/verify-payment", verifyUpiPayment);

// Get payment status
router.get("/payment-status/:paymentId", getPaymentStatus);

// Manual verification (for admin or when automatic verification fails)
router.post("/manual-verify", manualVerifyUpiPayment);

// Email approval/rejection endpoints
router.get("/approve-by-email", approveByEmail);
router.get("/reject-by-email", rejectByEmail);

// Debug endpoint (for testing)
router.get("/debug", debugPayments);

export default router;
