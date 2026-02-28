// src/controllers/adminAuthController.ts
import { Request, Response } from "express";
import { supabase } from "../config/supabase";
import nodemailer from "nodemailer";
import jwt from "jsonwebtoken";
import crypto from "crypto";

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT) || 587,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

// POST /api/auth/admin-send-otp
export const adminSendOTP = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const { email } = req.body as { email?: string };

  if (!email || typeof email !== "string") {
    res.status(400).json({ error: "Email is required" });
    return;
  }

  // Check if email exists in admin_users table
  const { data: adminUser, error: fetchError } = await supabase
    .from("admin_users")
    .select("id, email, is_active")
    .eq("email", email.toLowerCase().trim())
    .single();

  if (fetchError || !adminUser) {
    // Don't reveal whether email exists — just say OTP sent
    // But we won't actually send one. This prevents enumeration.
    res
      .status(200)
      .json({ userId: "invalid", message: "OTP sent if email is registered" });
    return;
  }

  if (!adminUser.is_active) {
    res
      .status(200)
      .json({ userId: "invalid", message: "OTP sent if email is registered" });
    return;
  }

  // Generate OTP
  const otp = crypto.randomInt(100000, 999999).toString();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 min

  // Delete old OTPs for this user
  await supabase.from("otp_codes").delete().eq("user_id", adminUser.id);

  // Insert new OTP
  const { error: insertError } = await supabase.from("otp_codes").insert({
    user_id: adminUser.id,
    code: otp,
    expires_at: expiresAt.toISOString(),
    used: false,
  });

  if (insertError) {
    res.status(500).json({ error: "Failed to generate OTP" });
    return;
  }

  // Send email
  try {
    await transporter.sendMail({
      from: `"Big Dawgs RC" <${process.env.SMTP_USER}>`,
      to: email,
      subject: "Admin Access OTP — Big Dawgs RC Store",
      html: `
        <div style="background:#000;color:#fff;padding:40px;font-family:monospace;max-width:480px;margin:0 auto;border:1px solid #1a1a1a;border-radius:12px">
          <h2 style="color:#FF6B00;margin-bottom:8px">🐾 ADMIN ACCESS</h2>
          <p style="color:#888;margin-bottom:24px">Your one-time password for Big Dawgs RC Admin Dashboard</p>
          <div style="background:#0f0f0f;border:1px solid #FF6B00;border-radius:8px;padding:24px;text-align:center;margin-bottom:24px">
            <p style="font-size:36px;font-weight:bold;letter-spacing:12px;color:#FF6B00">${otp}</p>
          </div>
          <p style="color:#555;font-size:12px">Valid for 10 minutes. Do not share this with anyone.</p>
        </div>
      `,
    });
  } catch {
    res.status(500).json({ error: "Failed to send OTP email" });
    return;
  }

  res.status(200).json({ userId: adminUser.id, message: "OTP sent" });
};

// POST /api/auth/admin-verify-otp
export const adminVerifyOTP = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const { userId, otp } = req.body as { userId?: string; otp?: string };

  if (!userId || !otp) {
    res.status(400).json({ error: "userId and otp are required" });
    return;
  }

  // Handle fake userId for non-existent emails
  if (userId === "invalid") {
    res.status(401).json({ error: "Invalid or expired OTP" });
    return;
  }

  // Find OTP
  const { data: otpRecord, error } = await supabase
    .from("otp_codes")
    .select("*")
    .eq("user_id", userId)
    .eq("code", otp)
    .eq("used", false)
    .gt("expires_at", new Date().toISOString())
    .single();

  if (error || !otpRecord) {
    res
      .status(400)
      .json({ error: "Invalid or expired OTP. Please try again." });
    return;
  }

  // Mark OTP as used
  await supabase
    .from("otp_codes")
    .update({ used: true })
    .eq("id", otpRecord.id);

  // Get admin user details + verify admin_key
  const { data: adminUser } = await supabase
    .from("admin_users")
    .select("id, email, admin_key")
    .eq("id", userId)
    .single();

  if (!adminUser) {
    res.status(401).json({ error: "Admin user not found" });
    return;
  }

  // Issue admin JWT
  const token = jwt.sign(
    { userId: adminUser.id, email: adminUser.email, role: "admin" },
    process.env.JWT_SECRET || "secret",
    { expiresIn: "8h" },
  );

  res.status(200).json({ token, email: adminUser.email });
};
