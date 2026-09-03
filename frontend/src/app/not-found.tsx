import { Clapperboard, Terminal } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from "@/components/ui/card";

export default function NotFound() {
  return (
    <div className="flex h-dvh w-full items-center justify-center bg-background p-6">
      <Card className="w-full max-w-md border-2 border-dashed border-border shadow-none ring-0">
        <CardHeader className="border-b border-dashed pb-4">
          <div className="flex items-center gap-2">
            <Terminal className="h-4 w-4" aria-hidden />
            <span className="font-mono text-sm">story_error.sh</span>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 py-6 font-mono">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">$</span>
            <span>fetch scene</span>
          </div>
          <div className="space-y-1 pl-6">
            <p className="text-4xl font-bold tracking-tight text-primary">
              404
            </p>
            <p className="text-muted-foreground">scene not found</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">$</span>
            <span>locate_scene</span>
            <span
              className="inline-block h-5 w-2 animate-pulse bg-foreground"
              aria-hidden
            />
          </div>
        </CardContent>
        <CardFooter className="border-t border-dashed pt-4">
          <Button asChild variant="outline" className="w-full font-mono">
            <Link href="/creator/ingest">
              <Clapperboard className="h-4 w-4" aria-hidden />$ cd
              /creator/ingest
            </Link>
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
