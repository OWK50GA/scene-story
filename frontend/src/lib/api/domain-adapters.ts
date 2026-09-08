import type { ApiClaim, ApiFinding } from "@/lib/api";
import type { Claim, Finding } from "@/lib/domain";

export function entityNameIndex(claims: ApiClaim[]): Map<string, string> {
  return new Map(claims.map((c) => [c.claimId, c.entity]));
}

export function claimToDomain(api: ApiClaim): Claim {
  return {
    id: api.claimId,
    entity: api.entity,
    entityType: "object",
    property: api.property,
    value: api.value,
    scene: api.scene,
    sourceType: api.sourceType,
    confidence: api.confidence,
    sourceLine: api.sourceLine,
  };
}

export function findingToDomain(
  api: ApiFinding,
  names: Map<string, string>,
): Finding {
  const entity =
    names.get(api.claimB.claimId) ??
    names.get(api.claimA.claimId) ??
    "Unknown entity";
  const property = api.claimA.property || api.claimB.property;

  return {
    id: api.findingId,
    title: `${entity} · ${property} changed between scenes`,
    severity: api.severity,
    conflict: api.conflict,
    claimA: {
      id: api.claimA.claimId,
      entity,
      entityType: "object",
      property: api.claimA.property,
      value: api.claimA.value,
      scene: api.claimA.scene,
      sourceType: api.claimA.sourceType,
      confidence: api.claimA.confidence,
      sourceLine: api.claimA.sourceLine,
    },
    claimB: {
      id: api.claimB.claimId,
      entity,
      entityType: "object",
      property: api.claimB.property,
      value: api.claimB.value,
      scene: api.claimB.scene,
      sourceType: api.claimB.sourceType,
      confidence: api.claimB.confidence,
      sourceLine: api.claimB.sourceLine,
    },
    explanation: api.explanation,
    suggestion: api.resolutionSuggestion,
    status: api.status,
  };
}
