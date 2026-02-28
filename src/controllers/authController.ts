import { Request, Response } from "express";
import { supabase } from "../config/supabase";
import { generateOTP, otpExpiresAt } from "../utils/otp";
import jwt from "jsonwebtoken";
import nodemailer from "nodemailer";

const JWT_SECRET = process.env.JWT_SECRET!;

// POST /api/auth/send-otp
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

    // Upsert user record
    const { data: user, error: userError } = await supabase
      .from("users")
      .upsert(
        {
          email: email || null,
          phone: phone || null,
          full_name: name || null,
        },
        { onConflict: "email" },
      )
      .select()
      .single();

    if (userError) {
      console.error("Supabase user error:", userError);
      throw userError;
    }

    console.log("User created/updated successfully:", user.id);

    // Store OTP in DB
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

    // Send OTP via email (skip for development if SMTP not configured)
    if (
      process.env.SMTP_HOST &&
      process.env.SMTP_USER &&
      process.env.SMTP_PASS
    ) {
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT),
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      });

      await transporter.sendMail({
        from: `"Big Dawgs RC" <${process.env.SMTP_USER}>`,
        to: email,
        subject: `Your Big Dawgs OTP: ${otp}`,
        html: `
          <div style="background:#000;color:#fff;padding:40px;font-family:Arial">
            <h2 style="color:#FF6B00">Big Dawgs RC Store</h2>
            <p>Your verification code is:</p>
            <h1 style="color:#FF6B00;font-size:48px;letter-spacing:8px">${otp}</h1>
            <p style="color:#888">This code expires in 10 minutes.</p>
          </div>
        `,
      });

      console.log("Email sent successfully");
    } else {
      console.log("SMTP not configured - OTP would be:", otp);
      console.log("In production, configure SMTP credentials in .env");
    }

    res.json({
      success: true,
      message: "OTP sent successfully",
      userId: user.id,
    });
  } catch (error: any) {
    console.error("Send OTP error:", error);
    res.status(500).json({ success: false, error: { message: error.message } });
  }
};

// POST /api/auth/verify-otp
// Body: { email: string, otp: string } OR { userId: string, otp: string }
export const verifyOTP = async (req: Request, res: Response) => {
  try {
    const { email, userId, otp } = req.body;

    // If email is provided, find the user first
    let targetUserId = userId;
    if (email && !userId) {
      const { data: user, error: userError } = await supabase
        .from("users")
        .select("id")
        .eq("email", email)
        .single();

      if (userError || !user) {
        return res
          .status(400)
          .json({ success: false, error: { message: "User not found" } });
      }
      targetUserId = user.id;
    }

    if (!targetUserId) {
      return res
        .status(400)
        .json({
          success: false,
          error: { message: "Email or userId required" },
        });
    }

    const { data, error } = await supabase
      .from("otp_codes")
      .select("*")
      .eq("user_id", targetUserId)
      .eq("code", otp)
      .eq("used", false)
      .single();

    if (error || !data) {
      return res
        .status(400)
        .json({ success: false, error: { message: "Invalid OTP" } });
    }

    if (new Date(data.expires_at) < new Date()) {
      return res
        .status(400)
        .json({ success: false, error: { message: "OTP has expired" } });
    }

    // Mark OTP as used
    await supabase.from("otp_codes").update({ used: true }).eq("id", data.id);

    // Generate JWT
    const token = jwt.sign({ userId: targetUserId }, JWT_SECRET, {
      expiresIn: "7d",
    });

    // Get user data
    const { data: user } = await supabase
      .from("users")
      .select("*")
      .eq("id", targetUserId)
      .single();

    res.json({ success: true, token, user });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
};
