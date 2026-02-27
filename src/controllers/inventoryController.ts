import { Request, Response } from "express";
import { supabase } from "../config/supabase";

// GET /api/inventory
export const getAllProducts = async (req: Request, res: Response) => {
  try {
    const {
      category,
      sort,
      min_price,
      max_price,
      page = 1,
      limit = 20,
    } = req.query;

    let query = supabase
      .from("products")
      .select(
        `
        id, slug, name, price, compare_price,
        stock_qty, is_featured, is_solar,
        categories(name, slug),
        product_images(url, sort_order)
      `,
      )
      .eq("is_active", true)
      .order("created_at", { ascending: false });

    if (category) query = query.eq("categories.slug", category as string);
    if (min_price) query = query.gte("price", Number(min_price));
    if (max_price) query = query.lte("price", Number(max_price));

    if (sort === "price_asc") query = query.order("price", { ascending: true });
    if (sort === "price_desc")
      query = query.order("price", { ascending: false });

    const from = (Number(page) - 1) * Number(limit);
    query = query.range(from, from + Number(limit) - 1);

    const { data, error, count } = await query;

    if (error) throw error;

    res.json({
      success: true,
      data,
      meta: { page: Number(page), limit: Number(limit), total: count },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
};

// GET /api/inventory/:category
export const getByCategory = async (req: Request, res: Response) => {
  try {
    const { category } = req.params;

    const { data: categoryData, error: catError } = await supabase
      .from("categories")
      .select("id, name, slug")
      .eq("slug", category)
      .single();

    if (catError || !categoryData) {
      return res
        .status(404)
        .json({ success: false, error: { message: "Category not found" } });
    }

    const { data, error } = await supabase
      .from("products")
      .select(
        `
        id, slug, name, price, compare_price,
        stock_qty, is_featured, is_solar, brand, specs,
        product_images(url, sort_order)
      `,
      )
      .eq("is_active", true)
      .eq("category_id", categoryData.id)
      .order("created_at", { ascending: false });

    if (error) throw error;

    res.json({ success: true, data, category: categoryData });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
};

// GET /api/inventory/:category/:slug
export const getProductBySlug = async (req: Request, res: Response) => {
  try {
    const { slug } = req.params;

    const { data, error } = await supabase
      .from("products")
      .select(
        `
        *,
        categories(name, slug),
        product_images(url, alt_text, sort_order),
        product_videos(url, type)
      `,
      )
      .eq("slug", slug)
      .eq("is_active", true)
      .single();

    if (error || !data) {
      return res
        .status(404)
        .json({ success: false, error: { message: "Product not found" } });
    }

    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
};

// GET /api/inventory/featured
export const getFeaturedProducts = async (req: Request, res: Response) => {
  try {
    const { data, error } = await supabase
      .from("products")
      .select(
        `
        id, slug, name, price, compare_price,
        stock_qty, is_solar, brand,
        categories(name, slug),
        product_images(url, sort_order)
      `,
      )
      .eq("is_active", true)
      .eq("is_featured", true)
      .limit(8);

    if (error) throw error;

    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
};
