import type {
  Claim,
  CompanionAnswer,
  IngestEvent,
  SceneSummary,
  StoryUnit,
} from "@/lib/domain";

const scenes: SceneSummary[] = [
  {
    number: 1,
    heading: "INT. HQ, MEINHARDT'S OFFICE",
    time: "Night",
    summary:
      "Meinhardt secures the Cipher Device in his iron safe. Clara Voss arrives and locks the Red Ledger in the filing cabinet.",
  },
  {
    number: 2,
    heading: "INT. HQ, BRIEFING ROOM",
    time: "Night",
    summary:
      "Clara recruits Dr. Hartley as a blind codebreaker. He has never heard of the device.",
  },
  {
    number: 3,
    heading: "INT. HQ, CORRIDOR",
    time: "Night",
    summary: "Clara checks her Signal Watch: 23:14.",
  },
  {
    number: 4,
    heading: "INT. HQ, MEINHARDT'S OFFICE",
    time: "Night",
    summary:
      "Meinhardt is gone. Clara writes her field report: device in the safe, right-side lock unoccupied.",
  },
  {
    number: 5,
    heading: "INT. HQ, HARTLEY'S ROOM",
    time: "Early morning",
    summary:
      "Hartley reports the fragment is pre-war German engineering and asks for the machine itself.",
  },
  {
    number: 6,
    heading: "INT. HQ, MEINHARDT'S OFFICE",
    time: "Morning",
    summary:
      "Meinhardt re-checks the device: key still in the left lock, right-side lock still empty. He orders nobody move it.",
  },
  {
    number: 7,
    heading: "INT. HQ, CORRIDOR",
    time: "Day",
    summary:
      "Hartley deduces a dual-lock activation system from the fragment alone.",
  },
  {
    number: 8,
    heading: "INT. HQ, RECORDS ROOM",
    time: "Day",
    summary:
      "Clara unlocks the cabinet, photographs the Red Ledger, returns and locks it.",
  },
  {
    number: 9,
    heading: "INT. HQ, STAIRWELL",
    time: "Day",
    summary:
      "Clara's satchel holds the Cipher Device. Both locks now hold a key.",
  },
  {
    number: 10,
    heading: "INT. SAFE HOUSE, EAST LONDON",
    time: "Night",
    summary:
      "Clara burns her notebook page: device acquired, keys two, intact.",
  },
  {
    number: 11,
    heading: "INT. HQ, BRIEFING ROOM",
    time: "Night",
    summary:
      "Meinhardt shows Hartley a photograph of the device. Hartley confirms the dual-lock read.",
  },
  {
    number: 12,
    heading: "INT. HQ, MEINHARDT'S OFFICE",
    time: "Night",
    summary: "Meinhardt opens the iron safe. It is empty. 'She's gone.'",
  },
  {
    number: 13,
    heading: "INT. ALLIED COMMAND, DOVER",
    time: "Dawn",
    summary:
      "Clara hands the Red Ledger to the Allied officers and walks out into the grey morning.",
  },
];

const claims: Claim[] = [
  {
    id: "c1",
    entity: "Cipher Device",
    entityType: "object",
    property: "location",
    value: "iron safe, Meinhardt's office",
    scene: 1,
    sourceType: "explicit",
    confidence: 1,
    sourceLine:
      "He closes the Cipher Device and locks it in his private iron safe.",
  },
  {
    id: "c2",
    entity: "Cipher Device",
    entityType: "object",
    property: "location",
    value: "iron safe, Meinhardt's office",
    scene: 6,
    sourceType: "explicit",
    confidence: 1,
    sourceLine: "The device stays here. In my safe. Nobody moves it.",
  },
  {
    id: "c3",
    entity: "Cipher Device",
    entityType: "object",
    property: "location",
    value: "Clara's satchel",
    scene: 9,
    sourceType: "explicit",
    confidence: 1,
    sourceLine:
      "The Cipher Device is inside, brass fittings visible through the open flap.",
  },
  {
    id: "c4",
    entity: "Cipher Device",
    entityType: "object",
    property: "possessor",
    value: "Colonel Meinhardt",
    scene: 1,
    sourceType: "explicit",
    confidence: 1,
    sourceLine:
      "He closes the Cipher Device and locks it in his private iron safe.",
  },
  {
    id: "c5",
    entity: "Cipher Device",
    entityType: "object",
    property: "possessor",
    value: "Clara Voss",
    scene: 9,
    sourceType: "explicit",
    confidence: 1,
    sourceLine: "She closes the satchel and continues down the stairs.",
  },
  {
    id: "c6",
    entity: "Cipher Device",
    entityType: "object",
    property: "keys inserted",
    value: "one, left-side lock",
    scene: 1,
    sourceType: "explicit",
    confidence: 1,
    sourceLine:
      "A single brass key inserted in the left-side lock. The right-side lock is empty.",
  },
  {
    id: "c7",
    entity: "Cipher Device",
    entityType: "object",
    property: "right-side lock",
    value: "empty",
    scene: 4,
    sourceType: "explicit",
    confidence: 1,
    sourceLine:
      "One activation key confirmed present. Right-side lock currently unoccupied.",
  },
  {
    id: "c8",
    entity: "Cipher Device",
    entityType: "object",
    property: "right-side lock",
    value: "empty",
    scene: 6,
    sourceType: "explicit",
    confidence: 1,
    sourceLine: "The right-side lock remains empty.",
  },
  {
    id: "c9",
    entity: "Cipher Device",
    entityType: "object",
    property: "right-side lock",
    value: "occupied by a second key",
    scene: 9,
    sourceType: "explicit",
    confidence: 1,
    sourceLine:
      "The right-side lock, which was confirmed empty … now holds a second key.",
  },
  {
    id: "c10",
    entity: "Red Ledger",
    entityType: "object",
    property: "location",
    value: "filing cabinet, HQ",
    scene: 1,
    sourceType: "explicit",
    confidence: 1,
    sourceLine:
      "Clara crosses to the filing cabinet on the far wall and locks the Red Ledger inside.",
  },
  {
    id: "c11",
    entity: "Red Ledger",
    entityType: "object",
    property: "location",
    value: "filing cabinet, HQ",
    scene: 8,
    sourceType: "explicit",
    confidence: 1,
    sourceLine:
      "She closes the ledger, returns it to the cabinet, and locks it again.",
  },
  {
    id: "c12",
    entity: "Red Ledger",
    entityType: "object",
    property: "location",
    value: "Allied officers' table, Dover",
    scene: 13,
    sourceType: "explicit",
    confidence: 1,
    sourceLine: "The Red Ledger remains on the table in Allied hands.",
  },
  {
    id: "c13",
    entity: "Red Ledger",
    entityType: "object",
    property: "possessor",
    value: "Clara Voss",
    scene: 1,
    sourceType: "explicit",
    confidence: 1,
    sourceLine:
      "Inside: a red ledger … its pages dense with handwritten codes.",
  },
  {
    id: "c14",
    entity: "Red Ledger",
    entityType: "object",
    property: "possessor",
    value: "Allied officers",
    scene: 13,
    sourceType: "explicit",
    confidence: 1,
    sourceLine: "One of the officers breaks the seal and reads.",
  },
  {
    id: "c15",
    entity: "Signal Watch",
    entityType: "object",
    property: "worn by",
    value: "Clara Voss, left wrist",
    scene: 1,
    sourceType: "explicit",
    confidence: 1,
    sourceLine:
      "She carries a leather satchel and wears a signal watch on her left wrist.",
  },
  {
    id: "c16",
    entity: "Signal Watch",
    entityType: "object",
    property: "crystal",
    value: "cracked",
    scene: 1,
    sourceType: "explicit",
    confidence: 1,
    sourceLine: "Hers has a cracked crystal from a prior operation.",
  },
  {
    id: "c17",
    entity: "Signal Watch",
    entityType: "object",
    property: "reading",
    value: "23:14",
    scene: 3,
    sourceType: "explicit",
    confidence: 1,
    sourceLine: "She checks the signal watch on her wrist. 23:14.",
  },
  {
    id: "c18",
    entity: "Clara Voss",
    entityType: "character",
    property: "location",
    value: "HQ, London",
    scene: 1,
    sourceType: "explicit",
    confidence: 1,
    sourceLine: "Agent Clara Voss, 30s, enters.",
  },
  {
    id: "c19",
    entity: "Clara Voss",
    entityType: "character",
    property: "location",
    value: "Dover, Allied Command",
    scene: 13,
    sourceType: "explicit",
    confidence: 1,
    sourceLine: "Clara turns and walks out into the grey Dover morning.",
  },
  {
    id: "c20",
    entity: "Clara Voss",
    entityType: "character",
    property: "allegiance",
    value: "British Intelligence",
    scene: 1,
    sourceType: "explicit",
    confidence: 1,
    sourceLine: "She drops the satchel on the desk.",
  },
  {
    id: "c21",
    entity: "Cabinet Key",
    entityType: "object",
    property: "possessor",
    value: "Clara Voss",
    scene: 1,
    sourceType: "explicit",
    confidence: 1,
    sourceLine: "She pockets the cabinet key.",
  },
  {
    id: "c22",
    entity: "Meinhardt",
    entityType: "character",
    property: "location",
    value: "HQ, London",
    scene: 1,
    sourceType: "explicit",
    confidence: 1,
    sourceLine: "Colonel Meinhardt, 50s, sits behind a heavy oak desk.",
  },
  {
    id: "c23",
    entity: "Hartley",
    entityType: "character",
    property: "knowledge of device",
    value: "none",
    scene: 1,
    sourceType: "explicit",
    confidence: 1,
    sourceLine:
      "He has not been briefed on the Cipher Device and does not know it is in the building.",
  },
  {
    id: "c24",
    entity: "Hartley",
    entityType: "character",
    property: "location",
    value: "HQ, London",
    scene: 2,
    sourceType: "explicit",
    confidence: 1,
    sourceLine: "Clara and Dr. Hartley … sit across from each other.",
  },
  {
    id: "c25",
    entity: "Iron Safe",
    entityType: "object",
    property: "state",
    value: "locked",
    scene: 4,
    sourceType: "explicit",
    confidence: 1,
    sourceLine: "She tries the iron safe. It is locked.",
  },
  {
    id: "c26",
    entity: "Iron Safe",
    entityType: "object",
    property: "state",
    value: "empty",
    scene: 12,
    sourceType: "explicit",
    confidence: 1,
    sourceLine: "He opens the iron safe. It is empty.",
  },
  {
    id: "c27",
    entity: "Cipher Device",
    entityType: "object",
    property: "keys inserted",
    value: "two",
    scene: 10,
    sourceType: "implied",
    confidence: 0.85,
    sourceLine: "Device acquired. Keys: two. Condition: intact.",
  },
  {
    id: "c28",
    entity: "Cipher Device",
    entityType: "object",
    property: "in building",
    value: "false",
    scene: 12,
    sourceType: "implied",
    confidence: 0.85,
    sourceLine: "'She's gone. And she's taken it with her.'",
  },
];

const events = [
  {
    id: "e1",
    scene: 1,
    subject: "Clara Voss",
    action: "locks in",
    object: "Red Ledger",
    description:
      "Clara locks the Red Ledger inside the filing cabinet and pockets the key.",
  },
  {
    id: "e2",
    scene: 8,
    subject: "Clara Voss",
    action: "removes from",
    object: "Red Ledger",
    description:
      "Clara unlocks the cabinet, removes the Red Ledger, photographs pages, returns it, and locks the cabinet.",
  },
  {
    id: "e3",
    scene: 13,
    subject: "Clara Voss",
    action: "delivers to",
    object: "Red Ledger",
    description: "Clara hands the Red Ledger to the Allied officers in Dover.",
  },
  {
    id: "e4",
    scene: 9,
    subject: "Clara Voss",
    action: "carries away",
    object: "Cipher Device",
    description:
      "Clara's satchel holds the Cipher Device as she descends the stairwell.",
  },
];

const claimA = claims.find((c) => c.id === "c2") as Claim;
const claimB = claims.find((c) => c.id === "c3") as Claim;
const claimC = claims.find((c) => c.id === "c8") as Claim;
const claimD = claims.find((c) => c.id === "c9") as Claim;

const findings = [
  {
    id: "f1",
    title: "Cipher Device leaves a locked safe without a transition",
    severity: "high" as const,
    conflict: "confirmed" as const,
    claimA,
    claimB,
    explanation:
      "Scene 6 confirms the Cipher Device in the iron safe and Meinhardt orders that nobody move it. Its next appearance, in scene 9, is inside Clara's satchel, with no event between the scenes explaining the removal.",
    suggestion:
      "Add an on-page beat showing the device leaving the safe, or mark intentional if the theft is meant to happen offscreen.",
    status: "open" as const,
  },
  {
    id: "f2",
    title: "A second key appears in the right-side lock without a source",
    severity: "medium" as const,
    conflict: "ambiguous" as const,
    claimA: claimC,
    claimB: claimD,
    explanation:
      "Scenes 4 and 6 establish the right-side lock as empty. Scene 9 shows it occupied by a second key. No scene introduces where the second key came from.",
    suggestion:
      "If this is the planted reveal of Clara's defection, mark intentional; the story opens the second-key thread on purpose.",
    status: "open" as const,
  },
];

export const filmA: StoryUnit = {
  title: "The Voss Cipher",
  slug: "voss-cipher",
  scenes,
  claims,
  events,
  findings,
};

const perSceneClaimCount = new Map<number, number>();
for (const c of claims) {
  perSceneClaimCount.set(c.scene, (perSceneClaimCount.get(c.scene) ?? 0) + 1);
}

export async function* simulateIngest(
  unit: StoryUnit,
): AsyncGenerator<IngestEvent> {
  let total = 0;
  for (const scene of unit.scenes) {
    await new Promise((resolve) => setTimeout(resolve, 260));
    const count = perSceneClaimCount.get(scene.number) ?? 0;
    total += count;
    yield { kind: "scene_complete", scene: scene.number, claimsWritten: count };
  }
  yield {
    kind: "ingestion_complete",
    sceneCount: unit.scenes.length,
    claimCount: total,
  };
}

function latestClaimAt(
  property: string,
  entity: string,
  upTo: number,
): Claim | undefined {
  const matches = claims.filter(
    (c) =>
      c.property === property &&
      (entity === "" || c.entity.includes(entity)) &&
      c.scene <= upTo,
  );
  if (matches.length === 0) return undefined;
  return [...matches].sort((a, b) => a.scene - b.scene).at(-1);
}

const QUESTION_ROUTES: Array<{
  match: RegExp;
  entity: string;
  property: string;
  kind: string;
}> = [
  {
    match: /cipher device|device/i,
    entity: "Cipher Device",
    property: "location",
    kind: "location",
  },
  {
    match: /red ledger|ledger/i,
    entity: "Red Ledger",
    property: "location",
    kind: "location",
  },
  {
    match: /right.?side lock|second key|key/i,
    entity: "Cipher Device",
    property: "right-side lock",
    kind: "lock",
  },
  {
    match: /signal watch|watch/i,
    entity: "Signal Watch",
    property: "worn by",
    kind: "plain",
  },
  {
    match: /clara|voss/i,
    entity: "Clara Voss",
    property: "location",
    kind: "location",
  },
  {
    match: /hartley/i,
    entity: "Hartley",
    property: "knowledge of device",
    kind: "plain",
  },
];

export function askCompanion(question: string, upTo: number): CompanionAnswer {
  const route = QUESTION_ROUTES.find((r) => r.match.test(question));
  if (route === undefined) {
    return {
      answer:
        "I can't match that to anything in the story so far. Try one of the suggested questions, or ask about the Cipher Device, the Red Ledger, the keys, or a character.",
      claimsUsed: [],
      notKnown: false,
    };
  }

  const claim = latestClaimAt(route.property, route.entity, upTo);
  if (claim === undefined) {
    const nextClaim = claims
      .filter(
        (c) => c.property === route.property && c.entity.includes(route.entity),
      )
      .sort((a, b) => a.scene - b.scene)[0];
    const revealAt = nextClaim?.scene;
    return {
      answer:
        revealAt === undefined
          ? "That hasn't come up in the story yet."
          : `You haven't reached that part of the story yet; it first appears around scene ${revealAt}.`,
      claimsUsed: [],
      notKnown: true,
    };
  }

  const earlier = claims.filter(
    (c) =>
      c.property === route.property &&
      c.entity.includes(route.entity) &&
      c.scene < claim.scene,
  );
  const used = [...earlier, claim].sort((a, b) => a.scene - b.scene);
  return {
    answer: formatAnswer(claim, route.kind, upTo),
    claimsUsed: used,
    notKnown: false,
  };
}

function formatAnswer(claim: Claim, kind: string, upTo: number): string {
  if (kind === "lock") {
    if (claim.value === "occupied by a second key") {
      return `As of scene ${upTo}, the right-side lock holds a second key, which was empty as recently as scene 6. Nobody on page has sourced it yet.`;
    }
    return `As of scene ${upTo}, the right-side lock is ${claim.value}.`;
  }
  return `As of scene ${upTo}: the ${claim.entity} is ${claim.value}.`;
}
