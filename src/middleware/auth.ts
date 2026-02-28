import { Request, Response, NextFunction } from "express";

export const requireApiKey = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const key = req.headers["x-api-key"];

  if (!key || key !== process.env.API_SECRET_KEY) {
    return res
      .status(401)
      .json({ success: false, error: { message: "Unauthorized" } });
  }

  next();
};
