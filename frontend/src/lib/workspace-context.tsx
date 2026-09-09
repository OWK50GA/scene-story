"use client";

import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

export type Workspace = {
  universeId?: string;
  projectId?: string;
  storyUnitId?: string;
};

type WorkspaceContextValue = {
  workspace: Workspace;
  select: (partial: Workspace) => void;
  clear: () => void;
};

const STORAGE_KEY = "lmm.workspace";

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

function readStored(): Workspace {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}");
    if (typeof parsed === "object" && parsed !== null) return parsed;
  } catch {
    // ignore malformed storage
  }
  return {};
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [workspace, setWorkspace] = useState<Workspace>({});
  const firstPersist = useRef(true);

  useEffect(() => {
    const stored = readStored();
    if (Object.keys(stored).length > 0) setWorkspace(stored);
  }, []);

  useEffect(() => {
    if (firstPersist.current) {
      firstPersist.current = false;
      return;
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace));
  }, [workspace]);

  return (
    <WorkspaceContext.Provider
      value={{
        workspace,
        select: (partial) => setWorkspace((prev) => ({ ...prev, ...partial })),
        clear: () => setWorkspace({}),
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace(): WorkspaceContextValue {
  const value = useContext(WorkspaceContext);
  if (value === null) {
    throw new Error("useWorkspace must be used within WorkspaceProvider");
  }
  return value;
}
