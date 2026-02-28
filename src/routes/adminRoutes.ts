// src/routes/adminRoutes.ts
import { Router, Request, Response, NextFunction } from "express";
import { supabase } from "../config/supabase";
import jwt from "jsonwebtoken";
import multer from "multer";

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

// ─── Types ────────────────────────────────────────────────────────────────────

interface AdminPayload {
  userId: string;
  email: string;
  role: string;
}

interface ProductBody {
  name: string;
  slug: string;
  category_id: string;
  brand: string;
  price: number;
  compare_price?: number;
  stock_qty: number;
  description: string;
  specs: Record<string, unknown>;
  tags: string[];
  is_solar: boolean;
  is_featured: boolean;
  is_active: boolean;
  images: string[]; // handled separately in product_images table
}

interface OrderRow {
  id: string;
  user_id: string;
  status: string;
  total_amount: number;
  shipping_address: Record<string, string>;
  created_at: string;
  razorpay_order_id: string;
  razorpay_payment_id: string;
  users: { email: string; name: string } | null;
  order_items: {
    id: string;
    product_id: string;
    quantity: number;
    price_at_purchase: number;
    products: { name: string } | null;
  }[];
}

// ─── Admin JWT Middleware ─────────────────────────────────────────────────────

function adminAuth(req: Request, res: Response, next: NextFunction): void {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    res.status(401).json({ error: "No admin token provided" });
    return;
  }
  try {
    const payload = jwt.verify(
      auth.slice(7),
      process.env.JWT_SECRET || "secret",
    ) as AdminPayload;
    if (payload.role !== "admin") throw new Error("Not admin");
    (req as Request & { admin: AdminPayload }).admin = payload;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired admin token" });
  }
}

// ─── Stats ────────────────────────────────────────────────────────────────────

router.get(
  "/stats",
  adminAuth,
  async (_req: Request, res: Response): Promise<void> => {
    const [ordersRes, productsRes] = await Promise.all([
      supabase.from("orders").select("id, total_amount, status"),
      supabase.from("products").select("id", { count: "exact" }),
    ]);

    const orders = (ordersRes.data || []) as {
      total_amount: number;
      status: string;
    }[];
    const totalRevenue = orders
      .filter((o) => o.status !== "cancelled")
      .reduce((sum, o) => sum + Number(o.total_amount || 0), 0);

    res.json({
      stats: {
        total_orders: orders.length,
        total_revenue: totalRevenue,
        total_products: productsRes.count || 0,
        pending_orders: orders.filter((o) => o.status === "pending").length,
      },
    });
  },
);

// ─── Categories ───────────────────────────────────────────────────────────────

router.get(
  "/categories",
  adminAuth,
  async (_req: Request, res: Response): Promise<void> => {
    const { data, error } = await supabase
      .from("categories")
      .select("id, name, slug")
      .order("name");
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.json({ categories: data });
  },
);

// ─── Products ─────────────────────────────────────────────────────────────────

router.get(
  "/products",
  adminAuth,
  async (_req: Request, res: Response): Promise<void> => {
    const { data, error } = await supabase
      .from("products")
      .select(
        `
      *,
      categories (id, name, slug),
      product_images (id, url, alt_text, sort_order)
    `,
      )
      .order("created_at", { ascending: false });

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.json({ products: data });
  },
);

router.post(
  "/products",
  adminAuth,
  async (req: Request, res: Response): Promise<void> => {
    const body = req.body as ProductBody;

    // Separate images from product data
    const { images, ...productData } = body;

    // Auto-generate slug if empty
    if (!productData.slug) {
      productData.slug = productData.name
        .toLowerCase()
        .replace(/\s+/g, "-")
        .replace(/[^a-z0-9-]/g, "");
    }

    // Insert product
    const { data: product, error: productError } = await supabase
      .from("products")
      .insert([
        {
          name: productData.name,
          slug: productData.slug,
          category_id: productData.category_id,
          brand: productData.brand || "",
          price: Number(productData.price),
          compare_price: productData.compare_price
            ? Number(productData.compare_price)
            : null,
          stock_qty: Number(productData.stock_qty),
          description: productData.description,
          specs: productData.specs || {},
          tags: productData.tags || [],
          is_solar: Boolean(productData.is_solar),
          is_featured: Boolean(productData.is_featured),
          is_active: productData.is_active !== false, // default true
        },
      ])
      .select()
      .single();

    if (productError) {
      console.error("Product insert error:", productError);
      res.status(500).json({ error: productError.message });
      return;
    }

    // Insert images into product_images table
    if (images && images.length > 0) {
      const imageRows = images.map((url: string, index: number) => ({
        product_id: product.id,
        url,
        alt_text: productData.name,
        sort_order: index,
      }));
      const { error: imgError } = await supabase
        .from("product_images")
        .insert(imageRows);
      if (imgError) console.error("Image insert error:", imgError);
    }

    res.status(201).json({ product });
  },
);

router.put(
  "/products/:id",
  adminAuth,
  async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const body = req.body as ProductBody;
    const { images, ...productData } = body;

    // Update product
    const { data: product, error: productError } = await supabase
      .from("products")
      .update({
        name: productData.name,
        slug: productData.slug,
        category_id: productData.category_id,
        brand: productData.brand || "",
        price: Number(productData.price),
        compare_price: productData.compare_price
          ? Number(productData.compare_price)
          : null,
        stock_qty: Number(productData.stock_qty),
        description: productData.description,
        specs: productData.specs || {},
        tags: productData.tags || [],
        is_solar: Boolean(productData.is_solar),
        is_featured: Boolean(productData.is_featured),
        is_active: productData.is_active !== false,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select()
      .single();

    if (productError) {
      res.status(500).json({ error: productError.message });
      return;
    }

    // Replace images — delete old, insert new
    if (images !== undefined) {
      await supabase.from("product_images").delete().eq("product_id", id);
      if (images.length > 0) {
        const imageRows = images.map((url: string, index: number) => ({
          product_id: id,
          url,
          alt_text: productData.name,
          sort_order: index,
        }));
        await supabase.from("product_images").insert(imageRows);
      }
    }

    res.json({ product });
  },
);

router.delete(
  "/products/:id",
  adminAuth,
  async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    // Delete images first (foreign key)
    await supabase.from("product_images").delete().eq("product_id", id);
    const { error } = await supabase.from("products").delete().eq("id", id);
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.json({ success: true });
  },
);

router.put(
  "/products/:id/stock",
  adminAuth,
  async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const { stock_qty } = req.body as { stock_qty: number };
    const { data, error } = await supabase
      .from("products")
      .update({
        stock_qty: Number(stock_qty),
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select()
      .single();
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.json({ product: data });
  },
);

// ─── Image Upload to Supabase Storage ─────────────────────────────────────────

router.post(
  "/upload-image",
  adminAuth,
  upload.single("file"),
  async (req: Request, res: Response): Promise<void> => {
    if (!req.file) {
      res.status(400).json({ error: "No file provided" });
      return;
    }

    const ext = req.file.originalname.split(".").pop() || "jpg";
    const fileName = `products/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

    const { error } = await supabase.storage
      .from("product-images")
      .upload(fileName, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: false,
      });

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    const { data: urlData } = supabase.storage
      .from("product-images")
      .getPublicUrl(fileName);

    res.json({ url: urlData.publicUrl });
  },
);

// ─── Orders ───────────────────────────────────────────────────────────────────

router.get(
  "/orders",
  adminAuth,
  async (_req: Request, res: Response): Promise<void> => {
    const { data, error } = await supabase
      .from("orders")
      .select(
        `
      *,
      users (email, name),
      order_items (
        id,
        product_id,
        quantity,
        price_at_purchase,
        products (name)
      )
    `,
      )
      .order("created_at", { ascending: false });

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    const orders = ((data as OrderRow[]) || []).map((o) => ({
      id: o.id,
      status: o.status,
      total_amount: o.total_amount,
      shipping_address: o.shipping_address,
      created_at: o.created_at,
      razorpay_order_id: o.razorpay_order_id,
      user_email: o.users?.email || null,
      user_name: o.users?.name || null,
      items: (o.order_items || []).map((item) => ({
        id: item.id,
        product_id: item.product_id,
        name: item.products?.name || "Unknown Product",
        quantity: item.quantity,
        price: item.price_at_purchase,
      })),
    }));

    res.json({ orders });
  },
);

router.put(
  "/orders/:id/status",
  adminAuth,
  async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const { status } = req.body as { status: string };
    const validStatuses = [
      "pending",
      "confirmed",
      "shipped",
      "delivered",
      "cancelled",
    ];
    if (!validStatuses.includes(status)) {
      res.status(400).json({ error: "Invalid status" });
      return;
    }
    const { data, error } = await supabase
      .from("orders")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.json({ order: data });
  },
);

export default router;
