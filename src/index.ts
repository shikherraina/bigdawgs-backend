import express, { Request, Response } from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import dotenv from "dotenv";
import inventoryRoutes from "./routes/inventory";
import authRoutes from "./routes/auth";
import orderRoutes from "./routes/orders";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// CORS must be before everything else
app.use(
  cors({
    origin: "*", // open for local dev — we'll tighten this for production
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "x-api-key", "Authorization"],
    preflightContinue: false,
    optionsSuccessStatus: 204,
  }),
);

// Handle preflight OPTIONS requests explicitly
app.options("*", cors());

app.use(
  helmet({
    crossOriginResourcePolicy: false, // don't block cross-origin requests
  }),
);
app.use(morgan("dev"));
app.use(express.json());

// Routes
app.use("/api/inventory", inventoryRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/orders", orderRoutes);

// Health check
app.get("/health", (req: Request, res: Response) => {
  res.json({
    status: "Big Dawgs API is running 🐾",
    timestamp: new Date().toISOString(),
  });
});

// 404
app.use((req: Request, res: Response) => {
  res
    .status(404)
    .json({ success: false, error: { message: "Route not found" } });
});

app.listen(PORT, () => {
  console.log(`🐾 Big Dawgs server running on port ${PORT}`);
});
