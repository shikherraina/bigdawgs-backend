// src/routes/adminRoutes.ts
import { Router, Request, Response, NextFunction } from "express";
import { supabase } from "../config/supabase";
import jwt from "jsonwebtoken";
import multer from "multer";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// ─── Admin JWT Middleware ─────────────────────────────────────────────────────

interface AdminPayload {
  userId: string;
  email: string;
  role: string;
}

function adminAuth(req: Request, res: Response, next: NextFunction): void {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    res.status(401).json({ error: "No admin token provided" });
    return;
  }
  try {
    const payload = jwt.verify(auth.slice(7), process.env.JWT_SECRET || "secret") as AdminPayload;
    if (payload.role !== "admin") throw new Error("Not admin");
    (req as Request & { admin: AdminPayload }).admin = payload;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired admin token" });
  }
}

// ─── Stats ────────────────────────────────────────────────────────────────────

router.get("/stats", adminAuth, async (_req: Request, res: Response): Promise<void> => {
  const [ordersRes, productsRes] = await Promise.all([
    supabase.from("orders").select("id, total, status"),
    supabase.from("products").select("id", { count: "exact" }),
  ]);

  const orders = ordersRes.data || [];
  const totalRevenue = orders
    .filter((o) => o.status !== "cancelled")
    .reduce((sum: number, o: { total: number }) => sum + (o.total || 0), 0);

  res.json({
    stats: {
      total_orders: orders.length,
      total_revenue: totalRevenue,
      total_products: productsRes.count || 0,
      pending_orders: orders.filter((o) => o.status === "pending").length,
    },
  });
});

// ─── Products ─────────────────────────────────────────────────────────────────

router.get("/products", adminAuth, async (_req: Request, res: Response): Promise<void> => {
  const { data, error } = await supabase
    .from("products")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ products: data });
});

router.post("/products", adminAuth, async (req: Request, res: Response): Promise<void> => {
  const body = req.body as Record<string, unknown>;
  const { data, error } = await supabase.from("products").insert([body]).select().single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.status(201).json({ product: data });
});

router.put("/products/:id", adminAuth, async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const body = req.body as Record<string, unknown>;
  const { data, error } = await supabase.from("products").update(body).eq("id", id).select().single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ product: data });
});

router.delete("/products/:id", adminAuth, async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const { error } = await supabase.from("products").delete().eq("id", id);
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ success: true });
});

router.put("/products/:id/stock", adminAuth, async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const { stock } = req.body as { stock: number };
  const { data, error } = await supabase.from("products").update({ stock }).eq("id", id).select().single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ product: data });
});

// ─── Image Upload ─────────────────────────────────────────────────────────────

router.post("/upload-image", adminAuth, upload.single("file"), async (req: Request, res: Response): Promise<void> => {
  if (!req.file) { res.status(400).json({ error: "No file provided" }); return; }

  const ext = req.file.originalname.split(".").pop() || "jpg";
  const fileName = `products/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

  const { error } = await supabase.storage
    .from("product-images")
    .upload(fileName, req.file.buffer, {
      contentType: req.file.mimetype,
      upsert: false,
    });

  if (error) { res.status(500).json({ error: error.message }); return; }

  const { data: urlData } = supabase.storage.from("product-images").getPublicUrl(fileName);
  res.json({ url: urlData.publicUrl });
});

// ─── Orders ───────────────────────────────────────────────────────────────────

router.get("/orders", adminAuth, async (_req: Request, res: Response): Promise<void> => {
  const { data, error } = await supabase
    .from("orders")
    .select(`
      *,
      users (email)
    `)
    .order("created_at", { ascending: false });

  if (error) { res.status(500).json({ error: error.message }); return; }

  const orders = (data || []).map((o) => ({
    ...o,
    user_email: (o.users as { email?: string } | null)?.email || null,
  }));

  res.json({ orders });
});

router.put("/orders/:id/status", adminAuth, async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const { status } = req.body as { status: string };
  const validStatuses = ["pending", "confirmed", "shipped", "delivered", "cancelled"];
  if (!validStatuses.includes(status)) {
    res.status(400).json({ error: "Invalid status" });
    return;
  }
  const { data, error } = await supabase.from("orders").update({ status }).eq("id", id).select().single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ order: data });
});

export default router;