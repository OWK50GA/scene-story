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

  GRAFANA_LOKI_URL: z.string().url().optional(),
  GRAFANA_LOKI_USERNAME: z.string().min(1).optional(),
  GRAFANA_LOKI_TOKEN: z.string().min(1).optional(),

  GRAFANA_PROMETHEUS_URL: z.string().url().optional(),
  GRAFANA_PROMETHEUS_USERNAME: z.string().min(1).optional(),
  GRAFANA_PROMETHEUS_TOKEN: z.string().min(1).optional(),

  GRAFANA_MCP_TOKEN: z.string().optional(),
  GRAFANA_STACK_URL: z.string().optional(),
});

export type Config = z.infer<typeof configSchema>;
