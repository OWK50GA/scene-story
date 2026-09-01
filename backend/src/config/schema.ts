import { z } from "zod";

export const configSchema = z.object({
  NODE_ENV: z.string(),
  PORT: z.number(),
  HOST: z.string(),

  GOOGLE_CLOUD_PROJECT_ID: z.string().optional(),
  GOOGLE_APPLICATION_CREDENTIALS: z.string(),
  GEMINI_API_KEY: z.string().min(1),

  CLICKHOUSE_HOST: z.string().min(1),
  CLICKHOUSE_PORT: z.number(),
  CLICKHOUSE_USERNAME: z.string(),
  CLICKHOUSE_PASSWORD: z.string().min(1),
  CLICKHOUSE_DATABASE: z.string(),

  GRAFANA_LOKI_URL: z.string().url(),
  GRAFANA_LOKI_USERNAME: z.string().min(1),
  GRAFANA_LOKI_TOKEN: z.string().min(1),

  GRAFANA_PROMETHEUS_URL: z.string().url(),
  GRAFANA_PROMETHEUS_USERNAME: z.string().min(1),
  GRAFANA_PROMETHEUS_TOKEN: z.string().min(1),

  GRAFANA_MCP_TOKEN: z.string().optional(),
  GRAFANA_STACK_URL: z.string().optional(),
});

export const config = configSchema.parse({
  // ... your existing object
});
