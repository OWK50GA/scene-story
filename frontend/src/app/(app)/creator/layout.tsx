import type { ReactNode } from "react";

import { CreatorHeader } from "@/components/app/creator-header";

export default function CreatorLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <CreatorHeader />
      <div className="scroll-stable min-h-0 flex-1 overflow-y-auto bg-surface p-6">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
          {children}
        </div>
      </div>
    </div>
  );
}
