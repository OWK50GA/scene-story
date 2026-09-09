"use client";

import {
  Check,
  ClipboardCopy,
  LoaderCircle,
  RefreshCw,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useScreenplayReader } from "@/components/screenplay/reader-context";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function SceneFixPanel() {
  const { fix, startFix, cancelFix, dismissFix } = useScreenplayReader();
  const [copied, setCopied] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (fix.status === "idle") return;
    panelRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [fix.status]);

  if (fix.status === "idle") return null;
  const busy = fix.status === "running";
  const text = fix.text;

  async function copyText() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div
      id="scene-fix-panel"
      ref={panelRef}
      className="my-4 rounded-lg border border-primary/40 bg-accent/30 p-4"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-foreground">
          {busy ? (
            <LoaderCircle
              className="h-3.5 w-3.5 animate-spin text-primary"
              aria-hidden
            />
          ) : (
            <Sparkles className="h-3.5 w-3.5 text-primary" aria-hidden />
          )}
          AI suggested revision
          <span className="font-mono text-muted-foreground">
            scene {fix.scene}
          </span>
        </p>
        <div className="flex items-center gap-1">
          {fix.status === "running" ? (
            <Button size="sm" variant="ghost" onClick={cancelFix}>
              <Square className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              Stop
            </Button>
          ) : (
            <>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => startFix(fix.findingId, fix.scene)}
              >
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                Regenerate
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void copyText()}>
                {copied ? (
                  <Check className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                ) : (
                  <ClipboardCopy className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                )}
                {copied ? "Copied" : "Copy"}
              </Button>
            </>
          )}
          <Button size="sm" variant="ghost" onClick={dismissFix}>
            <X className="h-3.5 w-3.5" aria-hidden />
            <span className="sr-only">Dismiss</span>
          </Button>
        </div>
      </div>

      {fix.status === "error" ? (
        <p className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {fix.message}
        </p>
      ) : null}

      {fix.status === "done" ? (
        <p className="mt-2 font-mono text-[11px] text-muted-foreground">
          {fix.oldText.length} chars → {fix.text.length} chars · preview only,
          nothing saved
        </p>
      ) : null}

      <p
        className={cn(
          "mt-3 max-h-64 overflow-y-auto whitespace-pre-wrap font-script text-[15px] leading-relaxed",
          fix.status === "error" && fix.text.length === 0 && "hidden",
        )}
      >
        {fix.text}
        {busy ? (
          <span
            className="ml-0.5 inline-block h-4 w-[2px] translate-y-0.5 animate-pulse bg-primary"
            aria-hidden
          />
        ) : null}
      </p>

      {fix.status === "done" ? (
        <p className="mt-3 border-t border-border/60 pt-3 text-xs text-muted-foreground">
          Review the revision above. Applying it to the stored screenplay and
          reconciling the story state is the next step in the pipeline.
        </p>
      ) : null}
    </div>
  );
}
