import type { Metadata } from "next";

import { FindingsScreen } from "@/components/views/findings-screen";

export const metadata: Metadata = {
  title: "Creator · Findings",
};

export default function FindingsPage() {
  return <FindingsScreen />;
}
