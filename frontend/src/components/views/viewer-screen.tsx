"use client";

import { Info, LockKeyhole, Send } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import type { CompanionAnswer } from "@/lib/domain";
import { askCompanion, filmA } from "@/lib/mock";

const EXAMPLES = [
  "Where is the Cipher Device?",
  "Who has the Red Ledger?",
  "Is the right-side lock still empty?",
  "Where is Clara?",
];

export function ViewerScreen() {
  const maxScene = filmA.scenes.length;
  const [scene, setScene] = useState(5);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<CompanionAnswer | null>(null);
  const [asked, setAsked] = useState("");

  function ask(text: string) {
    const q = text.trim();
    if (q === "") return;
    setAnswer(askCompanion(q, scene));
    setAsked(q);
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="text-lg">You&apos;re watching</CardTitle>
              <CardDescription>
                The Voss Cipher · film-a · {maxScene} scenes
              </CardDescription>
            </div>
            <Badge className="bg-accent font-medium text-accent-foreground">
              Scene {scene} of {maxScene}
            </Badge>
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label htmlFor="scene-slider">Spoiler boundary</Label>
              <span className="text-sm text-muted-foreground">
                answer using scenes 1 to {scene} only
              </span>
            </div>
            <Slider
              id="scene-slider"
              min={1}
              max={maxScene}
              step={1}
              value={[scene]}
              onValueChange={([value]) => setScene(value)}
            />
          </div>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Ask about the story</CardTitle>
          <CardDescription>
            The Audience Companion answers only from what you have already
            watched.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") ask(question);
              }}
              placeholder="e.g. Where is the Cipher Device?"
              aria-label="Your question"
            />
            <Button onClick={() => ask(question)}>
              <Send className="mr-2 h-4 w-4" aria-hidden />
              Ask
            </Button>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {EXAMPLES.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => {
                  setQuestion(example);
                  ask(example);
                }}
                className="border border-border bg-background px-3 py-1.5 font-mono text-xs text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground"
              >
                {example}
              </button>
            ))}
          </div>

          {answer ? (
            <div className="space-y-3 border-t border-border pt-4">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <LockKeyhole className="h-3.5 w-3.5" aria-hidden />
                <span>
                  Asked: “{asked}” · boundary enforced at scene {scene}
                </span>
              </div>

              <div
                className={
                  answer.notKnown
                    ? "rounded-lg border border-yellow-200 bg-warning px-4 py-3 text-sm text-warning-foreground"
                    : "rounded-lg border border-border bg-background px-4 py-3 text-sm"
                }
              >
                {answer.notKnown ? (
                  <Info className="mr-2 inline h-4 w-4" aria-hidden />
                ) : null}
                {answer.answer}
              </div>

              {answer.claimsUsed.length > 0 ? (
                <div className="space-y-1.5">
                  <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                    Facts used to answer
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {answer.claimsUsed.map((claim) => (
                      <Badge
                        key={claim.id}
                        variant="outline"
                        className="font-normal"
                      >
                        Scene {claim.scene} · {claim.entity} · {claim.property}:{" "}
                        {claim.value}
                      </Badge>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
