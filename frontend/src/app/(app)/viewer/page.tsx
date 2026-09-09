import type { Metadata } from "next";

import { ViewerScreen } from "@/components/views/viewer-screen";

export const metadata: Metadata = {
  title: "Audience Companion",
};

export default function ViewerPage() {
  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div className="flex h-12 shrink-0 items-center gap-4 border-b border-border bg-background px-5">
        <span className="text-sm font-semibold">Audience Companion</span>
      </div>
      <div className="scroll-stable min-h-0 flex-1 overflow-y-auto bg-surface p-6">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
          <ViewerScreen />
        </div>
      </div>
    </div>
  );
}
