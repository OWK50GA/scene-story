export type FixSseMeta = {
  unitId: string;
  unitTitle: string;
  findingId: string;
  scene: number;
  claims: { scene: number; property: string; value: string }[];
};

export type FindingFixCallbacks = {
  onMeta?: (meta: FixSseMeta) => void;
  onDelta: (text: string) => void;
  onDone?: (payload: {
    scene: number;
    oldText: string;
    newText: string;
  }) => void;
  onError?: (message: string) => void;
};

function readSseBlocks(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buffer = "";
  return (async function* sse() {
    for (;;) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
      if (done) break;
      for (;;) {
        const idx = buffer.indexOf("\n\n");
        if (idx === -1) break;
        const block = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        if (block.length > 0) yield block;
      }
    }
    if (buffer.length > 0) yield buffer;
  })();
}

export async function streamFindingFix(
  unitId: string,
  findingId: string,
  callbacks: FindingFixCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(
    `/api/units/${unitId}/findings/${findingId}/fix`,
    {
      method: "POST",
      headers: { accept: "text/event-stream" },
      signal,
    },
  );
  if (!response.ok || !response.body) {
    const body = await response.text().catch(() => "");
    throw new Error(body ? body : `Fix request failed (${response.status})`);
  }

  const reader = response.body.getReader();
  try {
    for await (const block of readSseBlocks(reader)) {
      for (const line of block.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(line.slice(6)) as Record<string, unknown>;
        } catch {
          continue;
        }
        switch (payload.type) {
          case "meta":
            callbacks.onMeta?.({
              unitId: String(payload.unitId ?? ""),
              unitTitle: String(payload.unitTitle ?? ""),
              findingId: String(payload.findingId ?? ""),
              scene: Number(payload.scene),
              claims: Array.isArray(payload.claims)
                ? (payload.claims as FixSseMeta["claims"])
                : [],
            });
            break;
          case "delta":
            callbacks.onDelta(String(payload.text ?? ""));
            break;
          case "done":
            callbacks.onDone?.({
              scene: Number(payload.scene),
              oldText: String(payload.oldText ?? ""),
              newText: String(payload.newText ?? ""),
            });
            break;
          case "error":
            callbacks.onError?.(String(payload.message ?? "Fix failed"));
            break;
        }
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}
