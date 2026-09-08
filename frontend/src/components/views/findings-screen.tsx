"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, CircleAlert, CircleCheck, CircleOff } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  getProjectFindings,
  getUnitClaims,
  patchFindingStatus,
} from "@/lib/api";
import { entityNameIndex, findingToDomain } from "@/lib/api/domain-adapters";
import { CONFLICT_LABEL, type Finding, type FindingStatus } from "@/lib/domain";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace-context";

const severityText: Record<Finding["severity"], string> = {
  high: "text-red-700",
  medium: "text-yellow-700",
  low: "text-muted-foreground",
};

const severityBar: Record<Finding["severity"], string> = {
  high: "bg-red-600",
  medium: "bg-yellow-500",
  low: "bg-muted-foreground",
};

const statusLabel: Record<FindingStatus, string> = {
  open: "open",
  marked_intentional: "marked intentional",
  resolved: "resolved",
};

function ClaimColumn({
  heading,
  claim,
}: {
  heading: string;
  claim: Finding["claimA"];
}) {
  return (
    <div>
      <p className="font-mono text-[11px] tracking-widest text-muted-foreground uppercase">
        {heading}
      </p>
      <div className="mt-2 space-y-3 border-l border-border pl-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold">{claim.entity}</p>
          <span className="font-mono text-[11px] text-muted-foreground">
            sc {claim.scene}
          </span>
        </div>
        <dl className="space-y-1.5">
          <div>
            <dt className="font-mono text-[11px] text-muted-foreground uppercase">
              property
            </dt>
            <dd className="text-sm font-medium">{claim.property}</dd>
          </div>
          <div>
            <dt className="font-mono text-[11px] text-muted-foreground uppercase">
              value
            </dt>
            <dd className="text-sm font-medium leading-snug">{claim.value}</dd>
          </div>
        </dl>
      </div>
      <p className="mt-3 border-l border-primary/50 pl-3 text-xs text-muted-foreground italic">
        “{claim.sourceLine}”
      </p>
    </div>
  );
}

function FindingItem({
  finding,
  status,
  onStatusChange,
}: {
  finding: Finding;
  status: FindingStatus;
  onStatusChange: (id: string, status: FindingStatus) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div
      className={cn(
        "border border-border bg-card",
        open && "border-foreground/20",
        status === "resolved" && "opacity-60",
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40"
      >
        <span
          className={cn("mt-1 h-4 w-1 shrink-0", severityBar[finding.severity])}
          aria-hidden
        />
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-sm font-semibold">{finding.title}</span>
          <span
            className={cn(
              "font-mono text-[11px] tracking-widest uppercase",
              severityText[finding.severity],
            )}
          >
            {finding.severity}
          </span>
          <span className="font-mono text-[11px] tracking-widest text-muted-foreground uppercase">
            {CONFLICT_LABEL[finding.conflict]}
          </span>
          {status !== "open" ? (
            <span className="font-mono text-[11px] tracking-widest text-muted-foreground uppercase">
              · {statusLabel[status]}
            </span>
          ) : null}
        </span>
        <ChevronDown
          className={cn(
            "mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200",
            open && "rotate-180",
          )}
          aria-hidden
        />
      </button>

      <div
        aria-hidden={!open}
        className={cn(
          "grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="overflow-hidden">
          <div
            className={cn(
              "space-y-5 border-t border-border px-4 py-5 transition-opacity duration-200",
              open ? "opacity-100" : "opacity-0",
            )}
          >
            <div className="grid gap-6 md:grid-cols-2">
              <ClaimColumn heading="claim a · earlier" claim={finding.claimA} />
              <div className="border-border md:border-l md:pl-6">
                <ClaimColumn heading="claim b · later" claim={finding.claimB} />
              </div>
            </div>

            <div className="border border-border bg-muted/40 p-4">
              <div className="flex items-start gap-3">
                <CircleAlert
                  className="mt-0.5 h-4 w-4 shrink-0 text-warning-foreground"
                  aria-hidden
                />
                <div className="space-y-2 text-sm">
                  <p>
                    <span className="font-semibold">
                      Why it&apos;s flagged.
                    </span>{" "}
                    {finding.explanation}
                  </p>
                  <p className="text-muted-foreground">
                    <span className="font-semibold text-foreground">
                      Suggested action.
                    </span>{" "}
                    {finding.suggestion}
                  </p>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {status === "resolved" ? (
                <p className="flex items-center gap-1.5 font-mono text-xs text-success-foreground">
                  <CircleCheck className="h-4 w-4" aria-hidden />
                  resolved · {finding.id}
                </p>
              ) : (
                <>
                  {status !== "marked_intentional" ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        onStatusChange(finding.id, "marked_intentional")
                      }
                    >
                      <CircleOff className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                      Mark intentional
                    </Button>
                  ) : null}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onStatusChange(finding.id, "resolved")}
                  >
                    <CircleCheck className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                    Resolve finding
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function FindingsScreen() {
  const { workspace } = useWorkspace();
  const queryClient = useQueryClient();
  const { projectId, storyUnitId } = workspace;

  const claimsQuery = useQuery({
    queryKey: ["unit-claims", storyUnitId],
    queryFn: () => getUnitClaims(storyUnitId as string),
    enabled: Boolean(storyUnitId),
  });

  const findingsQuery = useQuery({
    queryKey: ["project-findings", projectId],
    queryFn: () => getProjectFindings(projectId as string),
    enabled: Boolean(projectId),
  });

  const statusMutation = useMutation({
    mutationFn: ({
      findingId,
      status,
    }: {
      findingId: string;
      status: FindingStatus;
    }) => patchFindingStatus(projectId as string, findingId, status),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["project-findings", projectId],
      });
    },
  });

  const names = entityNameIndex(claimsQuery.data ?? []);
  const findings = (findingsQuery.data ?? []).map((f) =>
    findingToDomain(f, names),
  );

  function handleStatusChange(id: string, status: FindingStatus) {
    statusMutation.mutate({ findingId: id, status });
  }

  const openCount = findings.filter((f) => f.status === "open").length;
  const loading =
    !projectId || findingsQuery.isLoading || claimsQuery.isLoading;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold tracking-tight">
            Continuity findings
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {loading
              ? "Loading findings…"
              : "Conflicts the Continuity Guardian flagged in this story unit."}
          </p>
        </div>
        <span className="font-mono text-xs text-muted-foreground">
          {openCount} open / {findings.length}
        </span>
      </div>

      {loading ? (
        <p className="py-10 text-sm text-muted-foreground">Loading findings…</p>
      ) : findings.length === 0 ? (
        <div className="flex flex-col items-center gap-2 border border-dashed border-border px-6 py-14 text-center">
          <CircleCheck
            className="h-6 w-6 text-success-foreground"
            aria-hidden
          />
          <p className="text-sm font-medium">No contradictions found.</p>
          <p className="text-sm text-muted-foreground">
            Every active claim is explained by an event.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {findings.map((finding) => (
            <FindingItem
              key={finding.id}
              finding={finding}
              status={finding.status}
              onStatusChange={handleStatusChange}
            />
          ))}
        </div>
      )}
    </div>
  );
}
