import express, { Request, Response } from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import dotenv from "dotenv";
import inventoryRoutes from "./routes/inventory";
import authRoutes from "./routes/auth";
import orderRoutes from "./routes/orders";
import contactRoutes from "./routes/contactRoutes";
import adminRoutes from "./routes/adminRoutes";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "x-api-key", "Authorization"],
    preflightContinue: false,
    optionsSuccessStatus: 204,
  }),
);

app.options("*", cors());
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(morgan("dev"));
app.use(express.json());

// Routes — all must be before the 404 handler
app.use("/api/inventory", inventoryRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/contact", contactRoutes); // ← no authMiddleware, matches your pattern
app.use("/api/admin", adminRoutes);
// Health check
app.get("/health", (req: Request, res: Response) => {
  res.json({
    status: "Big Dawgs API is running 🐾",
    timestamp: new Date().toISOString(),
  });
});

// 404 — must be last
app.use((req: Request, res: Response) => {
  res
    .status(404)
    .json({ success: false, error: { message: "Route not found" } });
});

app.listen(PORT, () => {
  console.log(`🐾 Big Dawgs server running on port ${PORT}`);
});
