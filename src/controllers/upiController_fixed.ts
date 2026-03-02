import { Request, Response } from "express";
import { supabase } from "../config/supabase";
import QRCode from "qrcode";
import crypto from "crypto";
import nodemailer from "nodemailer";

// POST /api/upi/create-payment
// Body: { amount: number, upiId: string, merchantName: string, orderData: any }
export const createUpiPayment = async (req: Request, res: Response) => {
  try {
    const { amount, upiId, merchantName, orderData } = req.body;

    // Generate a unique transaction ID
    const transactionId = `UPI_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Create UPI payment URL
    const upiUrl = `upi://pay?pa=${upiId}&pn=${encodeURIComponent(merchantName)}&am=${amount}&cu=INR&tr=${transactionId}&tn=Payment for order`;

    // Generate QR code
    const qrCodeDataUrl = await QRCode.toDataURL(upiUrl);

    // Create pending payment record
    const { data: payment, error: paymentError } = await supabase
      .from("payments")
      .insert({
        transaction_id: transactionId,
        amount,
        status: "pending",
        payment_method: "upi",
        gateway: "upi", // Required field for payments table
        upi_id: upiId,
        qr_code_url: qrCodeDataUrl,
      })
      .select()
      .single();

    if (paymentError) throw paymentError;

    // Send email notification to admin about new UPI payment
    try {
      await sendApprovalEmail(
        payment,
        transactionId,
        upiUrl,
        amount,
        merchantName,
      );
    } catch (emailError) {
      console.error("Failed to send admin notification:", emailError);
    }

    res.json({
      success: true,
      payment: {
        id: payment.id,
        transactionId,
        qrCode: qrCodeDataUrl,
        upiUrl,
        amount,
        upiId,
        merchantName,
        status: "pending",
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
};

// POST /api/upi/verify-payment
// Body: { paymentId: string, transactionId: string, orderData: any }
export const verifyUpiPayment = async (req: Request, res: Response) => {
  try {
    const { paymentId, transactionId, orderData } = req.body;

    // In a real implementation, you would verify the payment with your bank/Payment Gateway
    // For now, we'll simulate payment verification
    // You can replace this with actual UPI payment verification logic

    // Update payment status to success (simulated)
    const { data: payment, error: paymentError } = await supabase
      .from("payments")
      .update({ status: "success" })
      .eq("id", paymentId)
      .select()
      .single();

    if (paymentError) throw paymentError;

    // Create order in DB
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .insert({
        user_id: orderData.userId,
        status: "confirmed",
        total_amount: orderData.totalAmount,
        shipping_address: orderData.shippingAddress,
        payment_method: "upi",
        transaction_id: transactionId,
      })
      .select()
      .single();

    if (orderError) throw orderError;

    // Insert order items + reduce stock
    for (const item of orderData.items) {
      await supabase.from("order_items").insert({
        order_id: order.id,
        product_id: item.id,
        quantity: item.quantity,
        price_at_purchase: item.price,
      });

      await supabase
        .from("products")
        .update({ stock_qty: supabase.rpc("decrement", { x: item.quantity }) })
        .eq("id", item.id);
    }

    // Link payment to order
    await supabase
      .from("payments")
      .update({ order_id: order.id })
      .eq("id", paymentId);

    res.json({
      success: true,
      orderId: order.id,
      paymentId: payment.id,
      message: "UPI payment verified successfully",
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
};

// GET /api/upi/payment-status/:paymentId
export const getPaymentStatus = async (req: Request, res: Response) => {
  try {
    const { paymentId } = req.params;

    const { data: payment, error } = await supabase
      .from("payments")
      .select("*")
      .eq("id", paymentId)
      .single();

    if (error) throw error;

    if (!payment) {
      return res.status(404).json({
        success: false,
        error: { message: "Payment not found" },
      });
    }

    res.json({
      success: true,
      payment: {
        id: payment.id,
        transactionId: payment.transaction_id,
        status: payment.status,
        amount: payment.amount,
        paymentMethod: payment.payment_method,
        createdAt: payment.created_at,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
};

// POST /api/upi/manual-verify
// Body: { paymentId: string, utrNumber?: string, screenshot?: string }
export const manualVerifyUpiPayment = async (req: Request, res: Response) => {
  try {
    const { paymentId, utrNumber, screenshot } = req.body;

    // Update payment with manual verification details
    const { data: payment, error: paymentError } = await supabase
      .from("payments")
      .update({
        status: "success",
        utr_number: utrNumber,
        screenshot_url: screenshot,
        verified_manually: true,
        verified_at: new Date().toISOString(),
      })
      .eq("id", paymentId)
      .select()
      .single();

    if (paymentError) throw paymentError;

    res.json({
      success: true,
      payment: {
        id: payment.id,
        status: payment.status,
        utrNumber: payment.utr_number,
        verifiedManually: payment.verified_manually,
        verifiedAt: payment.verified_at,
      },
      message: "Payment verified manually",
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
};

// GET /api/upi/approve-by-email?paymentId=xxx&token=xxx
export const approveByEmail = async (req: Request, res: Response) => {
  try {
    const { paymentId, token } = req.query;

    // Validate token
    if (token !== process.env.EMAIL_APPROVAL_TOKEN) {
      return res.status(401).send(`
        <html>
          <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
            <h1 style="color: red;">❌ Invalid Approval Token</h1>
            <p>The approval link is invalid or has expired.</p>
            <p>Please contact the administrator.</p>
          </body>
        </html>
      `);
    }

    // Update payment status to success
    const { data: payment, error } = await supabase
      .from("payments")
      .update({
        status: "success",
        verified_manually: true,
        verified_at: new Date().toISOString(),
        utr_number: "EMAIL_APPROVED_" + Date.now(),
      })
      .eq("id", paymentId)
      .select()
      .single();

    if (error) {
      return res.status(404).send(`
        <html>
          <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
            <h1 style="color: red;">❌ Payment Not Found</h1>
            <p>The payment could not be found or has already been processed.</p>
          </body>
        </html>
      `);
    }

    // Return HTML confirmation page
    res.send(`
      <html>
        <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
          <h1 style="color: green;">✅ Payment Approved Successfully!</h1>
          <p>Payment ID: ${paymentId}</p>
          <p>Amount: ₹${payment.amount}</p>
          <p>The payment has been approved and the customer will be notified.</p>
          <p style="margin-top: 30px;">
            <a href="#" onclick="window.close()">Close this window</a>
          </p>
        </body>
      </html>
    `);
  } catch (error: any) {
    res.status(500).send(`
      <html>
        <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
          <h1 style="color: red;">❌ Approval Failed</h1>
          <p>An error occurred while approving the payment.</p>
          <p>Error: ${error.message}</p>
        </body>
      </html>
    `);
  }
};

// GET /api/upi/reject-by-email?paymentId=xxx&token=xxx
export const rejectByEmail = async (req: Request, res: Response) => {
  try {
    const { paymentId, token } = req.query;

    // Validate token
    if (token !== process.env.EMAIL_APPROVAL_TOKEN) {
      return res.status(401).send(`
        <html>
          <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
            <h1 style="color: red;">❌ Invalid Rejection Token</h1>
            <p>The rejection link is invalid or has expired.</p>
            <p>Please contact the administrator.</p>
          </body>
        </html>
      `);
    }

    // Update payment status to failed
    const { data: payment, error } = await supabase
      .from("payments")
      .update({
        status: "failed",
        verified_manually: true,
        verified_at: new Date().toISOString(),
      })
      .eq("id", paymentId)
      .select()
      .single();

    if (error) {
      return res.status(404).send(`
        <html>
          <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
            <h1 style="color: red;">❌ Payment Not Found</h1>
            <p>The payment could not be found or has already been processed.</p>
          </body>
        </html>
      `);
    }

    // Return HTML confirmation page
    res.send(`
      <html>
        <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
          <h1 style="color: orange;">⚠️ Payment Rejected</h1>
          <p>Payment ID: ${paymentId}</p>
          <p>Amount: ₹${payment.amount}</p>
          <p>The payment has been rejected and the customer will be notified.</p>
          <p style="margin-top: 30px;">
            <a href="#" onclick="window.close()">Close this window</a>
          </p>
        </body>
      </html>
    `);
  } catch (error: any) {
    res.status(500).send(`
      <html>
        <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
          <h1 style="color: red;">❌ Rejection Failed</h1>
          <p>An error occurred while rejecting the payment.</p>
          <p>Error: ${error.message}</p>
        </body>
      </html>
    `);
  }
};

// GET /api/upi/debug - List all payments (for testing)
export const debugPayments = async (req: Request, res: Response) => {
  try {
    const { data: payments, error } = await supabase
      .from("payments")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(10);

    if (error) throw error;

    res.json({
      success: true,
      payments,
      total: payments.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
};

// Email notification function
async function sendApprovalEmail(
  payment: any,
  transactionId: string,
  upiUrl: string,
  amount: number,
  merchantName: string,
) {
  try {
    // Create email transporter
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || "smtp.gmail.com",
      port: parseInt(process.env.SMTP_PORT || "587"),
      secure: false,
      auth: {
        user: process.env.SMTP_USER || process.env.FROM_EMAIL,
        pass: process.env.SMTP_PASS,
      },
    });

    // Generate approval and rejection links
    const approvalToken = process.env.EMAIL_APPROVAL_TOKEN || "default-token";
    const approveLink = `${process.env.API_BASE_URL || "http://localhost:5000"}/api/upi/approve-by-email?paymentId=${payment.id}&token=${approvalToken}`;
    const rejectLink = `${process.env.API_BASE_URL || "http://localhost:5000"}/api/upi/reject-by-email?paymentId=${payment.id}&token=${approvalToken}`;

    // Email HTML template
    const emailHTML = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
          <h1 style="margin: 0; font-size: 28px;">🔔 UPI Payment Approval Required</h1>
          <p style="margin: 10px 0 0 0; opacity: 0.9;">New payment awaiting your confirmation</p>
        </div>
        
        <div style="background: white; padding: 30px; border: 1px solid #e0e0e0; border-top: none;">
          <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 25px;">
            <h2 style="color: #333; margin: 0 0 15px 0;">Payment Details</h2>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; font-size: 14px;">
              <div><strong>Payment ID:</strong> ${payment.id}</div>
              <div><strong>Transaction ID:</strong> ${transactionId}</div>
              <div><strong>Amount:</strong> <span style="color: #28a745; font-size: 18px; font-weight: bold;">₹${amount}</span></div>
              <div><strong>Merchant:</strong> ${merchantName}</div>
              <div><strong>UPI ID:</strong> ${payment.upi_id}</div>
              <div><strong>Status:</strong> <span style="color: #ffc107; font-weight: bold;">⏳ Pending</span></div>
            </div>
          </div>

          <div style="text-align: center; margin-bottom: 25px;">
            <img src="${payment.qr_code_url}" alt="Payment QR Code" style="width: 150px; height: 150px; border: 2px solid #ddd; border-radius: 8px;">
            <p style="margin: 10px 0 0 0; color: #666; font-size: 12px;">QR Code for reference</p>
          </div>

          <div style="text-align: center; margin-bottom: 20px;">
            <h3 style="color: #333; margin: 0 0 15px 0;">Quick Actions</h3>
            <div style="display: flex; gap: 15px; justify-content: center;">
              <a href="${approveLink}" 
                 style="background: #28a745; color: white; padding: 12px 25px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
                ✅ Approve Payment
              </a>
              <a href="${rejectLink}" 
                 style="background: #dc3545; color: white; padding: 12px 25px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
                ❌ Reject Payment
              </a>
            </div>
          </div>

          <div style="background: #fff3cd; border: 1px solid #ffeaa7; padding: 15px; border-radius: 6px; margin-top: 20px;">
            <p style="margin: 0; color: #856404; font-size: 13px;">
              <strong>⚠️ Important:</strong> Please verify the payment details before approving. 
              This action cannot be undone once approved.
            </p>
          </div>
        </div>

        <div style="background: #f8f9fa; padding: 20px; text-align: center; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 10px 10px; color: #666; font-size: 12px;">
          <p style="margin: 0;">This is an automated message from ${merchantName} Payment System</p>
          <p style="margin: 5px 0 0 0;">If you didn't expect this email, please contact support immediately.</p>
        </div>
      </div>
    `;

    // Send email
    const mailOptions = {
      from:
        process.env.FROM_EMAIL || `"${merchantName}" <noreply@bigdawgs.com>`,
      to: process.env.ADMIN_EMAIL || "admin@bigdawgs.com",
      subject: `🔔 UPI Payment Approval Required - ₹${amount}`,
      html: emailHTML,
    };

    await transporter.sendMail(mailOptions);
    console.log(`Approval email sent for payment: ${payment.id}`);
  } catch (error) {
    console.error("Email sending failed:", error);
    throw error;
  }
}
