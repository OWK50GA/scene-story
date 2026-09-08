import express from "express";
import cors from "cors";
import swaggerUi from "swagger-ui-express";
import { config } from "./config/index.js";
import { swaggerSpec } from "./config/swagger.js";
import universesRouter from "./routes/universes.js";
import unitsRouter from "./routes/units.js";
import projectsRouter from "./routes/projects.js";

export const app = express();

app.use(cors());
app.use(express.json());

// ── Request logger ───────────────────────────────────────────────────────────

app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const ms = Date.now() - start;
    const color =
      res.statusCode >= 500 ? "\x1b[31m" :  // red
      res.statusCode >= 400 ? "\x1b[33m" :  // yellow
      res.statusCode >= 200 ? "\x1b[32m" :  // green
      "\x1b[0m";
    console.log(
      `${color}${req.method}\x1b[0m ${req.path} → ${color}${res.statusCode}\x1b[0m \x1b[2m${ms}ms\x1b[0m`,
    );
  });
  next();
});

// ── API docs ────────────────────────────────────────────────────────────────

app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

app.get("/api-docs.json", (_req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.send(swaggerSpec);
});

// ── Routes ──────────────────────────────────────────────────────────────────

app.use("/api/universes", universesRouter);
app.use("/api/projects", projectsRouter);
app.use("/api/units", unitsRouter);

// ── Health ──────────────────────────────────────────────────────────────────

app.get("/health", (_req, res) => {
  res.json({ status: "healthy" });
});

// ── Server ──────────────────────────────────────────────────────────────────

const startServer = async () => {
  try {
    const server = app.listen(config.PORT, config.HOST, () => {
      console.log(`Server running on http://${config.HOST}:${config.PORT}`);
      console.log(`API docs at http://${config.HOST}:${config.PORT}/api-docs`);
    });

    process.on("SIGTERM", () => {
      console.log("SIGTERM received. Shutting down gracefully");
      server.close(() => {
        console.log("Server closed");
        process.exit(0);
      });
    });
  } catch (err) {
    console.error("Failed to start server:", err);
    process.exit(1);
  }
};

process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", error);
  process.exit(1);
});

if (process.env.NODE_ENV !== "test") {
  startServer();
}
