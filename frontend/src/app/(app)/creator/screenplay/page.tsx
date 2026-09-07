import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Metadata } from "next";

import { ScreenplayViewer } from "@/components/views/screenplay-viewer";
import { filmA } from "@/lib/mock";
import { parseScreenplay } from "@/lib/screenplay";

export const metadata: Metadata = {
  title: "Read",
};

export const dynamic = "force-dynamic";

async function readFixture(): Promise<string> {
  try {
    const file = path.join(process.cwd(), "..", "fixtures", "film-a.txt");
    return await readFile(file, "utf8");
  } catch {
    return "";
  }
}

export default async function ScreenplayPage() {
  const raw = await readFixture();

  if (raw === "") {
    return (
      <p className="text-sm text-muted-foreground">
        Screenplay fixture not found. Add fixtures/film-a.txt to the repo root.
      </p>
    );
  }

  const { lines, scenes } = parseScreenplay(raw);

  return (
    <ScreenplayViewer
      lines={lines}
      scenes={scenes}
      findings={filmA.findings}
      title={filmA.title}
    />
  );
}
