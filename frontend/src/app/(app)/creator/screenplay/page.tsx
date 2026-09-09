import type { Metadata } from "next";

import { ScreenplayScreen } from "@/components/views/screenplay-screen";

export const metadata: Metadata = {
  title: "Read",
};

export const dynamic = "force-dynamic";

export default function ScreenplayPage() {
  return <ScreenplayScreen />;
}
