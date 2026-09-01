import dotenv from "dotenv";
import { configSchema } from "./schema";

dotenv.config();

const configObj = {
    // Server configuration
    NODE_ENV: process.env.NODE_ENV || "development",
    PORT: parseInt(process.env.PORT || "3001"),
    HOST: process.env.NODE_ENV === "production" ? "0.0.0.0" : process.env.HOST || "localhost",

    // Google Cloud
    GOOGLE_CLOUD_PROJECT_ID: process.env.GOOGLE_CLOUD_PROJECT_ID,
    GOOGLE_APPLICATION_CREDENTIALS: process.env.GOOGLE_APPLICATION_CREDENTIALS || "./service-account.json",
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,

    // ClickHouse
    CLICKHOUSE_HOST: process.env.CLICKHOUSE_HOST,
    CLICKHOUSE_PORT: parseInt(process.env.CLICKHOUSE_PORT || "8443"),
    CLICKHOUSE_USERNAME: process.env.CLICKHOUSE_USERNAME || "default",
    CLICKHOUSE_PASSWORD: process.env.CLICKHOUSE_PASSWORD,
    CLICKHOUSE_DATABASE: process.env.CLICKHOUSE_DATABASE || "lmm",

    // Grafana - Logs
    GRAFANA_LOKI_URL: process.env.GRAFANA_LOKI_URL,
    GRAFANA_LOKI_USERNAME: process.env.GRAFANA_LOKI_USERNAME,
    GRAFANA_LOKI_TOKEN: process.env.GRAFANA_LOKI_TOKEN,

    // Grafana - Metrics
    GRAFANA_PROMETHEUS_URL: process.env.GRAFANA_PROMETHEUS_URL,
    GRAFANA_PROMETHEUS_USERNAME: process.env.GRAFANA_PROMETHEUS_USERNAME,
    GRAFANA_PROMETHEUS_TOKEN: process.env.GRAFANA_PROMETHEUS_TOKEN,

    // Grafana - MCP
    GRAFANA_MCP_TOKEN: process.env.GRAFANA_MCP_TOKEN,
    GRAFANA_STACK_URL: process.env.GRAFANA_STACK_URL,
}

export const config = configSchema.parse(configObj);