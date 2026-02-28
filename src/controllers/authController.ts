import { Request, Response } from "express";
import { supabase } from "../config/supabase";
import { generateOTP, otpExpiresAt } from "../utils/otp";
import jwt from "jsonwebtoken";
import { Resend } from "resend";

const JWT_SECRET = process.env.JWT_SECRET!;
const resend = new Resend(process.env.RESEND_API_KEY);

// ── POST /api/auth/send-otp ───────────────────────────────────────────────────
// Body: { email: string, phone: string, name: string }
export const sendOTP = async (req: Request, res: Response) => {
  try {
    const { email, phone, name } = req.body;

    if (!email && !phone) {
      return res.status(400).json({
        success: false,
        error: { message: "Email or phone required" },
      });
    }

    const otp = generateOTP();
    const expires = otpExpiresAt();

    console.log("Attempting to connect to Supabase...");

    // ── Find or Create User ──────────────────────────────────────────────────
    // Avoids duplicate key errors when same email/phone used again
    let user;

    const { data: existingUser } = await supabase
      .from("users")
      .select("*")
      .or(`email.eq.${email},phone.eq.${phone}`)
      .single();

    if (existingUser) {
      // User exists — update name if provided
      const { data: updatedUser, error: updateError } = await supabase
        .from("users")
        .update({
          full_name: name || existingUser.full_name,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existingUser.id)
        .select()
        .single();

      if (updateError) {
        console.error("Supabase update error:", updateError);
        throw updateError;
      }
      user = updatedUser;
    } else {
      // New user — insert fresh record
      const { data: newUser, error: insertError } = await supabase
        .from("users")
        .insert({
          email: email || null,
          phone: phone || null,
          full_name: name || null,
        })
        .select()
        .single();

      if (insertError) {
        console.error("Supabase insert error:", insertError);
        throw insertError;
      }
      user = newUser;
    }

    console.log("User created/updated successfully:", user.id);

    // ── Store OTP ────────────────────────────────────────────────────────────
    const { error: otpError } = await supabase.from("otp_codes").upsert(
      {
        user_id: user.id,
        code: otp,
        expires_at: expires.toISOString(),
        used: false,
      },
      { onConflict: "user_id" },
    );

    if (otpError) {
      console.error("Supabase OTP error:", otpError);
      throw otpError;
    }

    console.log("OTP stored successfully");

    // ── Send OTP Email via Resend ────────────────────────────────────────────
    if (email && process.env.RESEND_API_KEY) {
      const { error: emailError } = await resend.emails.send({
        from: process.env.EMAIL_FROM || "onboarding@resend.dev",
        to: email,
        subject: `Your Big Dawgs OTP: ${otp}`,
        html: `
          <div style="background:#000;color:#fff;padding:40px;font-family:Arial">
            <h2 style="color:#FF6B00">Big Dawgs RC Store</h2>
            <p style="color:#ccc">Your verification code is:</p>
            <h1 style="color:#FF6B00;font-size:48px;letter-spacing:8px;margin:20px 0">${otp}</h1>
            <p style="color:#888">This code expires in 10 minutes.</p>
            <p style="color:#555;font-size:12px;margin-top:32px">
              If you did not request this, please ignore this email.
            </p>
          </div>
        `,
      });

      if (emailError) {
        console.error("Resend email error:", emailError);
        throw new Error("Failed to send OTP email");
      }

      console.log("OTP email sent successfully to:", email);
    } else {
      // Development fallback — log OTP to console
      console.log("RESEND_API_KEY not configured — OTP is:", otp);
    }

    res.json({
      success: true,
      message: "OTP sent successfully",
      userId: user.id,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to send OTP";
    console.error("Send OTP error:", error);
    res.status(500).json({ success: false, error: { message } });
  }
};

// ── POST /api/auth/verify-otp ─────────────────────────────────────────────────
// Body: { userId: string, otp: string } OR { email: string, otp: string }
export const verifyOTP = async (req: Request, res: Response) => {
  try {
    const { email, userId, otp } = req.body;

    // Resolve userId from email if not directly provided
    let targetUserId: string = userId;

    if (email && !userId) {
      const { data: foundUser, error: userError } = await supabase
        .from("users")
        .select("id")
        .eq("email", email)
        .single();

      if (userError || !foundUser) {
        return res.status(400).json({
          success: false,
          error: { message: "User not found" },
        });
      }
      targetUserId = foundUser.id;
    }

    if (!targetUserId) {
      return res.status(400).json({
        success: false,
        error: { message: "Email or userId required" },
      });
    }

    // ── Verify OTP ───────────────────────────────────────────────────────────
    const { data, error } = await supabase
      .from("otp_codes")
      .select("*")
      .eq("user_id", targetUserId)
      .eq("code", otp)
      .eq("used", false)
      .single();

    if (error || !data) {
      return res.status(400).json({
        success: false,
        error: { message: "Invalid OTP" },
      });
    }

    if (new Date(data.expires_at) < new Date()) {
      return res.status(400).json({
        success: false,
        error: { message: "OTP has expired" },
      });
    }

    // ── Mark OTP as used ─────────────────────────────────────────────────────
    await supabase.from("otp_codes").update({ used: true }).eq("id", data.id);

    // ── Generate JWT ─────────────────────────────────────────────────────────
    const token = jwt.sign({ userId: targetUserId }, JWT_SECRET, {
      expiresIn: "7d",
    });

    // ── Return user data ─────────────────────────────────────────────────────
    const { data: user } = await supabase
      .from("users")
      .select("*")
      .eq("id", targetUserId)
      .single();

    res.json({ success: true, token, user });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Verification failed";
    res.status(500).json({ success: false, error: { message } });
  }
};
