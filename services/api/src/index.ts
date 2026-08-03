import express from "express";
import cors from "cors";

process.on("unhandledRejection", (err) => {
  console.error("[UNHANDLED REJECTION]", err);
});
process.on("uncaughtException", (err) => {
  console.error("[UNCAUGHT EXCEPTION]", err);
});
import { authRouter } from "./routes/auth.js";
import { driversRouter } from "./routes/drivers.js";
import { guestsRouter } from "./routes/guests.js";
import { locationsRouter } from "./routes/locations.js";
import { adminRouter } from "./routes/admin.js";
import { tripsRouter } from "./routes/trips.js";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true, service: "baraat-api" }));

app.use("/auth", authRouter);
app.use("/drivers", driversRouter);
app.use("/guests", guestsRouter);
app.use("/locations", locationsRouter);
app.use("/admin", adminRouter);
app.use("/trips", tripsRouter);

app.use(
  (err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  },
);

const port = Number(process.env.API_PORT ?? 4000);
app.listen(port, () => console.log(`baraat-api listening on :${port}`));
