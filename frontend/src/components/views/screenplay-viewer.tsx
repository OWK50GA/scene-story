"use client";

import { FindingsRail } from "@/components/screenplay/findings-rail";
import { ScreenplayReaderProvider } from "@/components/screenplay/reader-context";
import { ScreenplayPaper } from "@/components/screenplay/script-document";
import { ReaderToolbar } from "@/components/screenplay/viewer-toolbar";
import type { Finding } from "@/lib/domain";
import type { DocLine, SceneAnchor } from "@/lib/screenplay";

export function ScreenplayViewer({
  lines,
  scenes,
  findings,
  title,
}: {
  lines: DocLine[];
  scenes: SceneAnchor[];
  findings: Finding[];
  title: string;
}) {
  return (
    <ScreenplayReaderProvider lines={lines} scenes={scenes} findings={findings}>
      <div className="flex flex-col gap-4">
        <ReaderToolbar />
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_330px]">
          <ScreenplayPaper title={title} sceneCount={scenes.length} />
          <FindingsRail />
        </div>
      </div>
    </ScreenplayReaderProvider>
  );
}
