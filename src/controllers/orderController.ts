import { Request, Response } from "express";
import { supabase } from "../config/supabase";
import Razorpay from "razorpay";
import crypto from "crypto";
import QRCode from "qrcode";

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID!,
  key_secret: process.env.RAZORPAY_KEY_SECRET!,
});

// POST /api/orders/create-razorpay-order
// Body: { amount: number, currency: string }
export const createRazorpayOrder = async (req: Request, res: Response) => {
  try {
    const { amount } = req.body;

    const order = await razorpay.orders.create({
      amount: Math.round(amount * 100), // Razorpay uses paise
      currency: "INR",
      receipt: `rcpt_${Date.now()}`,
    });

    res.json({ success: true, order });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
};

// POST /api/orders/verify-payment
// Body: { razorpay_order_id, razorpay_payment_id, razorpay_signature, orderData }
export const verifyPayment = async (req: Request, res: Response) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      orderData, // { userId, items, totalAmount, shippingAddress }
    } = req.body;

    // Verify signature
    const body = `${razorpay_order_id}|${razorpay_payment_id}`;
    const expectedSig = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET!)
      .update(body)
      .digest("hex");

    if (expectedSig !== razorpay_signature) {
      return res.status(400).json({
        success: false,
        error: { message: "Payment verification failed" },
      });
    }

    // Create order in DB
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .insert({
        user_id: orderData.userId,
        status: "confirmed",
        total_amount: orderData.totalAmount,
        shipping_address: orderData.shippingAddress,
        razorpay_order_id,
        razorpay_payment_id,
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

    // Create payment record
    await supabase.from("payments").insert({
      order_id: order.id,
      amount: orderData.totalAmount,
      status: "success",
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    });

    res.json({ success: true, orderId: order.id });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
};

// POST /api/orders/create-upi-payment
// Body: { amount: number, upiId: string, merchantName: string }
export const createUpiPaymentOrder = async (req: Request, res: Response) => {
  try {
    const { amount, upiId, merchantName } = req.body;

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
