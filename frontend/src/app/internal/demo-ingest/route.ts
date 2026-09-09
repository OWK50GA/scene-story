import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const backendUrl = process.env.BACKEND_URL ?? "http://localhost:3001";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  let storyUnitId: string | undefined;
  try {
    ({ storyUnitId } = (await request.json()) as { storyUnitId?: string });
  } catch {
    return NextResponse.json({ message: "Invalid JSON body" }, { status: 400 });
  }

  if (!storyUnitId || !UUID_RE.test(storyUnitId)) {
    return NextResponse.json(
      { message: "storyUnitId must be a valid UUID" },
      { status: 400 },
    );
  }

  const encodedUnitId = encodeURIComponent(storyUnitId);

  let fileBuffer: Buffer;
  try {
    const fixturePath = path.join(
      process.cwd(),
      "..",
      "fixtures",
      "film-a.txt",
    );
    fileBuffer = await readFile(fixturePath);
  } catch {
    return NextResponse.json(
      { message: "Fixture fixtures/film-a.txt not found" },
      { status: 404 },
    );
  }

  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(fileBuffer)], { type: "text/plain" }),
    "film-a.txt",
  );

  try {
    const response = await fetch(
      `${backendUrl}/api/units/${encodedUnitId}/ingest`,
      { method: "POST", body: form },
    );
    const json = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      return NextResponse.json(json, { status: response.status });
    }
    return NextResponse.json(json);
  } catch {
    return NextResponse.json(
      { message: `Backend unreachable at ${backendUrl}` },
      { status: 502 },
    );
  }
}
