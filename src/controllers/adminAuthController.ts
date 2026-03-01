// src/controllers/adminAuthController.ts
import { Request, Response } from "express";
import { supabase } from "../config/supabase";
import nodemailer from "nodemailer";
import jwt from "jsonwebtoken";
import crypto from "crypto";

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT) || 587,
  secure: Number(process.env.SMTP_PORT) === 465,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  tls: { rejectUnauthorized: false }, // prevents TLS errors on some providers
});

// ── POST /api/auth/admin-send-otp ─────────────────────────────────────────────
export const adminSendOTP = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { email } = req.body as { email?: string };

    if (!email || typeof email !== "string" || !email.trim()) {
      res.status(400).json({ error: "Email is required" });
      return;
    }

    const normalizedEmail = email.toLowerCase().trim();

    // ── Look up admin user ───────────────────────────────────────────────────
    // Use maybeSingle() — .single() throws 406 if no row found
    const { data: adminUser, error: fetchError } = await supabase
      .from("admin_users")
      .select("id, email, is_active")
      .eq("email", normalizedEmail)
      .maybeSingle();

    if (fetchError) {
      console.error("[adminSendOTP] Supabase fetch error:", fetchError);
      // Still return a vague success to prevent email enumeration
      res
        .status(200)
        .json({
          userId: "invalid",
          message: "OTP sent if email is registered",
        });
      return;
    }

    // Not found or inactive — return vague success (security: no enumeration)
    if (!adminUser || !adminUser.is_active) {
      console.warn(
        `[adminSendOTP] Unknown or inactive email: ${normalizedEmail}`,
      );
      res
        .status(200)
        .json({
          userId: "invalid",
          message: "OTP sent if email is registered",
        });
      return;
    }

    // ── Generate OTP ─────────────────────────────────────────────────────────
    const otp = crypto.randomInt(100000, 999999).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    // ── Delete old OTPs, insert new one ──────────────────────────────────────
    await supabase.from("otp_codes").delete().eq("user_id", adminUser.id);

    const { error: insertError } = await supabase.from("otp_codes").insert({
      user_id: adminUser.id,
      code: otp,
      expires_at: expiresAt,
      used: false,
    });

    if (insertError) {
      console.error("[adminSendOTP] OTP insert error:", insertError);
      res.status(500).json({ error: "Failed to generate OTP" });
      return;
    }

    // ── Send email via nodemailer ─────────────────────────────────────────────
    try {
      await transporter.sendMail({
        from: `"Big Dawgs RC" <${process.env.SMTP_USER}>`,
        to: normalizedEmail,
        subject: "Admin Access OTP — Big Dawgs RC Store",
        html: `
          <div style="background:#000;color:#fff;padding:40px;font-family:monospace;max-width:480px;margin:0 auto;border:1px solid #1a1a1a;border-radius:12px">
            <h2 style="color:#FF6B00;margin-bottom:8px">🐾 ADMIN ACCESS</h2>
            <p style="color:#888;margin-bottom:24px">Your one-time password for Big Dawgs RC Admin Dashboard</p>
            <div style="background:#0f0f0f;border:1px solid #FF6B00;border-radius:8px;padding:24px;text-align:center;margin-bottom:24px">
              <p style="font-size:36px;font-weight:bold;letter-spacing:12px;color:#FF6B00;margin:0">${otp}</p>
            </div>
            <p style="color:#555;font-size:12px">Valid for 10 minutes. Do not share this with anyone.</p>
          </div>
        `,
      });
      console.log(`[adminSendOTP] OTP email sent to ${normalizedEmail}`);
    } catch (emailError) {
      console.error("[adminSendOTP] Email send failed:", emailError);
      res.status(500).json({
        error:
          emailError instanceof Error
            ? `Email delivery failed: ${emailError.message}`
            : "Failed to send OTP email",
      });
      return;
    }

    res.status(200).json({ userId: adminUser.id, message: "OTP sent" });
  } catch (err) {
    console.error("[adminSendOTP] Unhandled error:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Failed to send OTP",
    });
  }
};

// ── POST /api/auth/admin-verify-otp ──────────────────────────────────────────
export const adminVerifyOTP = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { userId, otp } = req.body as { userId?: string; otp?: string };

    if (!userId || !otp) {
      res.status(400).json({ error: "userId and otp are required" });
      return;
    }

    if (otp.trim().length !== 6) {
      res.status(400).json({ error: "OTP must be 6 digits" });
      return;
    }

    // ── Fake userId guard ─────────────────────────────────────────────────────
    if (userId === "invalid") {
      res.status(401).json({ error: "Invalid or expired OTP" });
      return;
    }

    // ── Fetch latest unused OTP for this user ─────────────────────────────────
    // Using maybeSingle() + order by expires_at — more resilient than matching code in query
    const { data: otpRecord, error: otpError } = await supabase
      .from("otp_codes")
      .select("*")
      .eq("user_id", userId)
      .eq("used", false)
      .order("expires_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (otpError) {
      console.error("[adminVerifyOTP] OTP fetch error:", otpError);
      res.status(500).json({ error: "Failed to verify OTP" });
      return;
    }

    if (!otpRecord) {
      res
        .status(400)
        .json({ error: "No active OTP found. Please request a new one." });
      return;
    }

    // ── Check expiry ──────────────────────────────────────────────────────────
    if (new Date(otpRecord.expires_at as string) < new Date()) {
      res
        .status(400)
        .json({ error: "OTP has expired. Please request a new one." });
      return;
    }

    // ── Check code ────────────────────────────────────────────────────────────
    if (String(otpRecord.code).trim() !== String(otp).trim()) {
      res.status(400).json({ error: "Incorrect OTP. Please try again." });
      return;
    }

    // ── Mark as used ──────────────────────────────────────────────────────────
    const { error: markError } = await supabase
      .from("otp_codes")
      .update({ used: true })
      .eq("id", otpRecord.id);

    if (markError) {
      console.error("[adminVerifyOTP] Failed to mark OTP used:", markError);
      // Non-fatal — continue
    }

    // ── Fetch admin user ──────────────────────────────────────────────────────
    const { data: adminUser, error: adminFetchError } = await supabase
      .from("admin_users")
      .select("id, email, admin_key")
      .eq("id", userId)
      .maybeSingle();

    if (adminFetchError || !adminUser) {
      console.error(
        "[adminVerifyOTP] Admin user fetch error:",
        adminFetchError,
      );
      res.status(401).json({ error: "Admin user not found" });
      return;
    }

    // ── Issue JWT ─────────────────────────────────────────────────────────────
    const token = jwt.sign(
      { userId: adminUser.id, email: adminUser.email, role: "admin" },
      process.env.JWT_SECRET || "secret",
      { expiresIn: "8h" },
    );

    console.log(`[adminVerifyOTP] Login success for ${adminUser.email}`);
    res.status(200).json({ token, email: adminUser.email });
  } catch (err) {
    console.error("[adminVerifyOTP] Unhandled error:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Verification failed",
    });
  }
};
