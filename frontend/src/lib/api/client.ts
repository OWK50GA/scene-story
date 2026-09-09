import { type FetchOptions, ofetch } from "ofetch";

export type ApiErrorPayload = {
  status?: string;
  message?: string;
  error?: string;
  code?: string;
};

export class ApiError extends Error {
  readonly statusCode: number;
  readonly code?: string;

  constructor(statusCode: number, message: string, code?: string) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

const apiFetch = ofetch.create({
  baseURL: "/api",
  headers: {
    accept: "application/json",
  },
});

function normalizeError(err: unknown): never {
  if (err instanceof ApiError) throw err;
  if (err && typeof err === "object" && "statusCode" in err) {
    const fetchErr = err as {
      statusCode?: number;
      data?: ApiErrorPayload;
      message?: string;
    };
    const payload = fetchErr.data;
    const message =
      payload?.message ??
      payload?.error ??
      fetchErr.message ??
      "Request failed";
    throw new ApiError(fetchErr.statusCode ?? 0, message, payload?.code);
  }
  throw new ApiError(0, err instanceof Error ? err.message : "Request failed");
}

async function request<T>(
  path: string,
  options?: FetchOptions<"json">,
): Promise<T> {
  try {
    return (await apiFetch(path, options)) as T;
  } catch (err) {
    normalizeError(err);
  }
}

function hasData(raw: unknown): raw is { data: unknown } {
  return (
    typeof raw === "object" &&
    raw !== null &&
    "data" in raw &&
    (raw as { data: unknown }).data !== undefined
  );
}

export async function apiGet<T>(
  path: string,
  options?: FetchOptions<"json">,
): Promise<T> {
  return request<T>(path, { ...options, method: "GET" });
}

export async function apiPost<T>(
  path: string,
  body: unknown,
  options?: FetchOptions<"json">,
): Promise<T> {
  return request<T>(path, {
    ...options,
    method: "POST",
    body: body as BodyInit,
  });
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, { method: "PATCH", body: body as BodyInit });
}

export async function apiPostForm<T>(path: string, form: FormData): Promise<T> {
  return request<T>(path, { method: "POST", body: form as BodyInit });
}

/**
 * Unwraps the common { status, data } envelope. Endpoints that return a bare
 * success object (no `data` key) pass through unchanged.
 */
export function payload<T>(raw: unknown): T {
  if (hasData(raw)) return raw.data as T;
  return raw as T;
}
