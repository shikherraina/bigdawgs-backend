// src/routes/contactRoutes.ts
import { Router, Request, Response } from "express";
import { supabase } from "../config/supabase"; // adjust path to your supabase client

const router = Router();

router.post("/", async (req: Request, res: Response): Promise<void> => {
  const { name, email, phone, message } = req.body as {
    name: unknown;
    email: unknown;
    phone: unknown;
    message: unknown;
  };

  if (
    typeof name !== "string" ||
    !name.trim() ||
    typeof email !== "string" ||
    !email.trim() ||
    typeof phone !== "string" ||
    !phone.trim() ||
    typeof message !== "string" ||
    !message.trim()
  ) {
    res.status(400).json({ error: "All fields are required" });
    return;
  }

  const { error } = await supabase.from("contact_messages").insert([
    {
      name: name.trim(),
      email: email.trim(),
      phone: phone.trim(),
      message: message.trim(),
    },
  ]);

  if (error) {
    console.error("Contact save error:", error);
    res.status(500).json({ error: "Failed to save message" });
    return;
  }

  res.status(200).json({ success: true });
});

export default router;
