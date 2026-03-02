import { Request, Response } from "express";
import { supabase } from "../config/supabase";

// GET /api/admin/pending-payments
// Get all pending UPI payments for admin approval
export const getPendingPayments = async (req: Request, res: Response) => {
  try {
    const { data: payments, error } = await supabase
      .from("payments")
      .select(`
        *,
        orders:user_id(id, status)
      `)
      .eq("status", "pending")
      .eq("payment_method", "upi")
      .order("created_at", { ascending: false });

    if (error) throw error;

    res.json({ success: true, payments });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
};

// POST /api/admin/approve-payment
// Approve a pending UPI payment
export const approvePayment = async (req: Request, res: Response) => {
  try {
    const { paymentId, utrNumber, notes } = req.body;

    // Update payment status to success
    const { data: payment, error: paymentError } = await supabase
      .from("payments")
      .update({ 
        status: "success",
        utr_number: utrNumber,
        verified_manually: true,
        verified_at: new Date().toISOString()
      })
      .eq("id", paymentId)
      .select()
      .single();

    if (paymentError) throw paymentError;

    // If there's associated order data, create the order
    if (payment.order_id) {
      // This assumes order data was stored somewhere - you might need to modify this
      // based on how you're storing the order information
    }

    res.json({
      success: true,
      payment: {
        id: payment.id,
        status: payment.status,
        utrNumber: payment.utr_number,
        verifiedAt: payment.verified_at
      },
      message: "Payment approved successfully"
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
};

// POST /api/admin/reject-payment
// Reject a pending UPI payment
export const rejectPayment = async (req: Request, res: Response) => {
  try {
    const { paymentId, reason } = req.body;

    const { data: payment, error } = await supabase
      .from("payments")
      .update({ 
        status: "failed",
        verified_manually: true,
        verified_at: new Date().toISOString()
      })
      .eq("id", paymentId)
      .select()
      .single();

    if (error) throw error;

    res.json({
      success: true,
      payment: {
        id: payment.id,
        status: payment.status,
        verifiedAt: payment.verified_at
      },
      message: "Payment rejected"
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
};
