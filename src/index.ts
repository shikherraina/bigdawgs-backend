import express, { Request, Response } from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import dotenv from "dotenv";
import inventoryRoutes from "./routes/inventory";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(helmet());
app.use(
  cors({
    origin: [
      process.env.FRONTEND_URL || "http://localhost:3000",
      "http://localhost:3000",
    ],
    credentials: true,
  }),
);
app.use(morgan("dev"));
app.use(express.json());

// Routes
app.use("/api/inventory", inventoryRoutes);

// Health check
app.get("/health", (req: Request, res: Response) => {
  res.json({
    status: "Big Dawgs API is running 🐾",
    timestamp: new Date() .toISOString(),
  });
});

// 404 handler
app.use((req: Request, res: Response) => {
  res
    .status(404)
    .json({ success: false, error: { message: "Route not found" } });
});

app.listen(PORT, () => {
  console.log(`🐾 Big Dawgs server running on port ${PORT}`);
});
