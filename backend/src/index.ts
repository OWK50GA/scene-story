import express from "express";
import cors from "cors";
import { config } from "./config";

export const app = express();

app.use(cors());
app.use(express.json())

app.get("/api-docs.json", (_req, res) => {
    res.setHeader("Content-Type", "application/json");
    // Send swagger spec
});

app.get("/health", (_req, res) => {
    res.json({ status: "healthy" });
});

const startServer = async () => {
    try {
        const server = app.listen(config.PORT, config.HOST, () => {
            console.log("App running on port ", config.PORT);
        });

        process.on('SIGTERM', () => {
            console.log("SIGTERM received. Shutting down gracefully");
            server.close(() => {
                console.log("Server closed");
                process.exit(0);
            });
        });
    } catch (err) {
        console.error("Failed to start server: ", err);
        process.exit(1);
    }
}

process.on('uncaughtException', (error) => {
    console.error("Uncaught exception: ", error);
    process.exit(1);
})

if (process.env.NODE_ENV !== "test") {
    startServer();
}
