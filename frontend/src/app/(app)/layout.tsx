import type { ReactNode } from "react";

import { AppRail } from "@/components/app/app-rail";
import { AppTopBar } from "@/components/app/app-top-bar";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-dvh w-full overflow-hidden bg-background text-foreground">
      <AppRail />
      <div className="flex min-w-0 flex-1 flex-col">
        <AppTopBar />
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      </div>
    </div>
  );
}
