import { Request, Response } from "express";
import { supabase } from "../config/supabase";
import { generateOTP, otpExpiresAt } from "../utils/otp";
import jwt from "jsonwebtoken";
import { Resend } from "resend";

const JWT_SECRET = process.env.JWT_SECRET!;
const resend = new Resend(process.env.RESEND_API_KEY);

// ── POST /api/auth/send-otp ───────────────────────────────────────────────────
export const sendOTP = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, phone, name } = req.body as {
      email?: string;
      phone?: string;
      name?: string;
    };

    // ── Validate input ───────────────────────────────────────────────────────
    if (!email && !phone) {
      res.status(400).json({
        success: false,
        error: { message: "Email or phone required" },
      });
      return;
    }

    // ── Validate email format ────────────────────────────────────────────────
    if (email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        res.status(400).json({
          success: false,
          error: { message: "Invalid email format" },
        });
        return;
      }
    }

    const otp = generateOTP();
    const expires = otpExpiresAt();

    // Ensure expires is a valid date
    const expiresISO =
      expires instanceof Date
        ? expires.toISOString()
        : new Date(Date.now() + 10 * 60 * 1000).toISOString();

    console.log(`[sendOTP] Request for email=${email} phone=${phone}`);

    // ── Find or Create User ──────────────────────────────────────────────────
    let user: Record<string, string>;

    const { data: existingUser } = await supabase
      .from("users")
      .select("*")
      .or(
        [email ? `email.eq.${email}` : null, phone ? `phone.eq.${phone}` : null]
          .filter(Boolean)
          .join(","),
      )
      .maybeSingle(); // maybeSingle() won't error if no row found — safer than single()

    if (existingUser) {
      const { data: updatedUser, error: updateError } = await supabase
        .from("users")
        .update({ full_name: name || existingUser.full_name })
        .eq("id", existingUser.id)
        .select()
        .single();

      if (updateError) {
        console.error("[sendOTP] User update error:", updateError);
        res.status(500).json({
          success: false,
          error: { message: "Failed to update user record" },
        });
        return;
      }
      user = updatedUser as Record<string, string>;
    } else {
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
        console.error("[sendOTP] User insert error:", insertError);
        res.status(500).json({
          success: false,
          error: { message: "Failed to create user record" },
        });
        return;
      }
      user = newUser as Record<string, string>;
    }

    console.log(`[sendOTP] User resolved: ${user.id}`);

    // ── Store OTP ────────────────────────────────────────────────────────────
    const { error: otpError } = await supabase.from("otp_codes").upsert(
      {
        user_id: user.id,
        code: otp,
        expires_at: expiresISO,
        used: false,
      },
      { onConflict: "user_id" },
    );

    if (otpError) {
      console.error("[sendOTP] OTP upsert error:", otpError);
      res.status(500).json({
        success: false,
        error: { message: "Failed to store OTP" },
      });
      return;
    }

    console.log(`[sendOTP] OTP stored for user: ${user.id}`);

    // ── Send OTP Email ───────────────────────────────────────────────────────
    if (email) {
      if (!process.env.RESEND_API_KEY) {
        // Dev fallback — still succeed, just log
        console.warn(`[sendOTP] No RESEND_API_KEY — OTP for ${email}: ${otp}`);
      } else {
        try {
          const emailResult = await resend.emails.send({
            from: process.env.EMAIL_FROM || "onboarding@resend.dev",
            to: email,
            subject: `Your Big Dawgs OTP: ${otp}`,
            html: `
              <div style="background:#000;color:#fff;padding:40px;font-family:Arial,sans-serif;max-width:480px">
                <div style="display:flex;align-items:center;gap:10px;margin-bottom:24px">
                  <div style="width:40px;height:40px;background:linear-gradient(135deg,#FF3D00,#FF6B00);border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:18px">🐾</div>
                  <h2 style="color:#FF6B00;margin:0;font-size:20px">Big Dawgs RC Store</h2>
                </div>
                <p style="color:#ccc;margin-bottom:8px">Your verification code is:</p>
                <div style="background:#111;border:1px solid #FF6B00;border-radius:12px;padding:24px;text-align:center;margin:16px 0">
                  <span style="color:#FF6B00;font-size:48px;font-weight:bold;letter-spacing:12px">${otp}</span>
                </div>
                <p style="color:#888;font-size:14px">This code expires in <strong>10 minutes</strong>.</p>
                <p style="color:#555;font-size:12px;margin-top:24px;border-top:1px solid #222;padding-top:16px">
                  If you did not request this, please ignore this email.
                </p>
              </div>
            `,
          });

          // Resend returns { data, error } — check properly
          if (emailResult.error) {
            console.error("[sendOTP] Resend error:", emailResult.error);
            // Don't throw — OTP is stored, email failed
            // Still return success so user can manually enter OTP if needed
            // But log for debugging
            res.status(500).json({
              success: false,
              error: {
                message: `Email delivery failed: ${JSON.stringify(emailResult.error)}`,
              },
            });
            return;
          }

          console.log(
            `[sendOTP] Email sent to ${email}, id: ${emailResult.data?.id}`,
          );
        } catch (emailException) {
          // Network/SDK crash — catch separately
          console.error("[sendOTP] Email send exception:", emailException);
          res.status(500).json({
            success: false,
            error: {
              message:
                emailException instanceof Error
                  ? `Email service error: ${emailException.message}`
                  : "Email service unavailable",
            },
          });
          return;
        }
      }
    }

    // ── Success ──────────────────────────────────────────────────────────────
    res.json({
      success: true,
      message: "OTP sent successfully",
      userId: user.id,
    });
  } catch (error) {
    console.error("[sendOTP] Unhandled error:", error);
    res.status(500).json({
      success: false,
      error: {
        message: error instanceof Error ? error.message : "Failed to send OTP",
      },
    });
  }
};

// ── POST /api/auth/verify-otp ─────────────────────────────────────────────────
export const verifyOTP = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, userId, otp } = req.body as {
      email?: string;
      userId?: string;
      otp?: string;
    };

    // ── Validate input ───────────────────────────────────────────────────────
    if (!otp || otp.trim().length !== 6) {
      res.status(400).json({
        success: false,
        error: { message: "A 6-digit OTP is required" },
      });
      return;
    }

    if (!userId && !email) {
      res.status(400).json({
        success: false,
        error: { message: "userId or email is required" },
      });
      return;
    }

    // ── Resolve userId ───────────────────────────────────────────────────────
    let targetUserId: string;

    if (userId) {
      targetUserId = userId;
    } else {
      const { data: foundUser, error: userError } = await supabase
        .from("users")
        .select("id")
        .eq("email", email!)
        .maybeSingle();

      if (userError || !foundUser) {
        res.status(400).json({
          success: false,
          error: { message: "User not found" },
        });
        return;
      }
      targetUserId = foundUser.id as string;
    }

    // ── Fetch OTP record ─────────────────────────────────────────────────────
    const { data: otpRecord, error: otpFetchError } = await supabase
      .from("otp_codes")
      .select("*")
      .eq("user_id", targetUserId)
      .eq("used", false)
      .order("expires_at", { ascending: false }) // get latest
      .limit(1)
      .maybeSingle();

    if (otpFetchError || !otpRecord) {
      console.warn(`[verifyOTP] No active OTP for user: ${targetUserId}`);
      res.status(400).json({
        success: false,
        error: { message: "No active OTP found. Please request a new one." },
      });
      return;
    }

    // ── Check expiry ─────────────────────────────────────────────────────────
    if (new Date(otpRecord.expires_at as string) < new Date()) {
      res.status(400).json({
        success: false,
        error: { message: "OTP has expired. Please request a new one." },
      });
      return;
    }

    // ── Check code match ─────────────────────────────────────────────────────
    if (String(otpRecord.code).trim() !== String(otp).trim()) {
      res.status(400).json({
        success: false,
        error: { message: "Incorrect OTP. Please try again." },
      });
      return;
    }

    // ── Mark as used ─────────────────────────────────────────────────────────
    const { error: markError } = await supabase
      .from("otp_codes")
      .update({ used: true })
      .eq("id", otpRecord.id);

    if (markError) {
      console.error("[verifyOTP] Failed to mark OTP used:", markError);
      // Non-fatal — continue anyway
    }

    // ── Issue JWT ─────────────────────────────────────────────────────────────
    const token = jwt.sign({ userId: targetUserId }, JWT_SECRET, {
      expiresIn: "7d",
    });

    // ── Fetch full user ───────────────────────────────────────────────────────
    const { data: user, error: userFetchError } = await supabase
      .from("users")
      .select("*")
      .eq("id", targetUserId)
      .single();

    if (userFetchError || !user) {
      console.error(
        "[verifyOTP] Could not fetch user after verify:",
        userFetchError,
      );
      res.status(500).json({
        success: false,
        error: { message: "Verified but could not load user data" },
      });
      return;
    }

    console.log(`[verifyOTP] Success for user: ${targetUserId}`);

    res.json({ success: true, token, user });
  } catch (error) {
    console.error("[verifyOTP] Unhandled error:", error);
    res.status(500).json({
      success: false,
      error: {
        message: error instanceof Error ? error.message : "Verification failed",
      },
    });
  }
};
