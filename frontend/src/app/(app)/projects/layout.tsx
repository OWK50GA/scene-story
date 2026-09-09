import type { ReactNode } from "react";

export default function ProjectsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="scroll-stable min-h-0 flex-1 overflow-y-auto bg-surface">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 p-6 lg:p-10">
        {children}
      </div>
    </div>
  );
}
