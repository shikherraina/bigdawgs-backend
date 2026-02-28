import { Router } from "express";
import { sendOTP, verifyOTP } from "../controllers/authController";
import {
  adminSendOTP,
  adminVerifyOTP,
} from "../controllers/adminAuthController";

const router = Router();
router.post("/send-otp", sendOTP);
router.post("/verify-otp", verifyOTP);
router.post("/admin-send-otp", adminSendOTP);
router.post("/admin-verify-otp", adminVerifyOTP);
export default router;
