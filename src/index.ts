import { Request, Response } from "express";
import { supabase } from "./config/supabase";
import { generateOTP, otpExpiresAt } from "././utils/otp";
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

    if (!email && !phone) {
      res.status(400).json({
        success: false,
        error: { message: "Email or phone required" },
      });
      return;
    }

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
    const expiresISO =
      expires instanceof Date
        ? expires.toISOString()
        : new Date(Date.now() + 10 * 60 * 1000).toISOString();

    console.log(`[sendOTP] Request for email=${email} phone=${phone}`);

    // ── Find or create user ──────────────────────────────────────────────────
    let user: Record<string, string>;

    const orFilter = [
      email ? `email.eq.${email}` : null,
      phone ? `phone.eq.${phone}` : null,
    ]
      .filter(Boolean)
      .join(",");

    const { data: existingUser } = await supabase
      .from("users")
      .select("*")
      .or(orFilter)
      .maybeSingle();

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
    const { error: otpError } = await supabase
      .from("otp_codes")
      .upsert(
        { user_id: user.id, code: otp, expires_at: expiresISO, used: false },
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

    // ── Send OTP via Resend (HTTPS port 443 — works on all cloud platforms) ──
    if (email) {
      try {
        const { data: emailData, error: emailError } = await resend.emails.send(
          {
            from: "Big Dawgs RC Store <noreply@bigdawgs.store>",
            to: email,
            subject: `${otp} is your Big Dawgs verification code`,
            html: `
            <div style="background:#000;color:#fff;padding:40px;font-family:Arial,sans-serif;max-width:480px;margin:0 auto">
              <div style="margin-bottom:24px">
                <span style="color:#FF6B00;font-size:20px;font-weight:bold">🐾 Big Dawgs RC Store</span>
              </div>
              <p style="color:#ccc;font-size:15px;margin-bottom:8px">Hi ${name || "there"},</p>
              <p style="color:#ccc;font-size:15px;margin-bottom:24px">Your verification code for checkout is:</p>
              <div style="background:#111;border:2px solid #FF6B00;border-radius:12px;padding:28px;text-align:center;margin:0 0 24px">
                <span style="color:#FF6B00;font-size:52px;font-weight:bold;letter-spacing:14px">${otp}</span>
              </div>
              <p style="color:#888;font-size:14px">
                This code expires in <strong style="color:#fff">10 minutes</strong>.
                Do not share it with anyone.
              </p>
              <hr style="border:none;border-top:1px solid #222;margin:24px 0">
              <p style="color:#555;font-size:12px">
                You're receiving this because someone is checking out at Big Dawgs RC Store.
                If this wasn't you, please ignore this email.
              </p>
            </div>
          `,
          },
        );

        if (emailError) {
          console.error("[sendOTP] Resend error:", emailError);
          res.status(500).json({
            success: false,
            error: { message: `Email delivery failed: ${emailError.message}` },
          });
          return;
        }

        console.log(
          `[sendOTP] Email sent successfully to ${email} — id: ${emailData?.id}`,
        );
      } catch (emailErr) {
        console.error("[sendOTP] Email send exception:", emailErr);
        res.status(500).json({
          success: false,
          error: {
            message:
              emailErr instanceof Error
                ? `Email delivery failed: ${emailErr.message}`
                : "Failed to send OTP email. Please try again.",
          },
        });
        return;
      }
    }

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

    // ── Fetch latest unused OTP ──────────────────────────────────────────────
    const { data: otpRecord, error: otpFetchError } = await supabase
      .from("otp_codes")
      .select("*")
      .eq("user_id", targetUserId)
      .eq("used", false)
      .order("expires_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (otpFetchError || !otpRecord) {
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

    // ── Check code ───────────────────────────────────────────────────────────
    if (String(otpRecord.code).trim() !== String(otp).trim()) {
      res.status(400).json({
        success: false,
        error: { message: "Incorrect OTP. Please try again." },
      });
      return;
    }

    // ── Mark as used ─────────────────────────────────────────────────────────
    await supabase
      .from("otp_codes")
      .update({ used: true })
      .eq("id", otpRecord.id);

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
