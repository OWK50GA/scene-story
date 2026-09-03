import type { Metadata } from "next";

import { IngestScreen } from "@/components/views/ingest-screen";

export const metadata: Metadata = {
  title: "Creator · Ingest",
};

export default function IngestPage() {
  return <IngestScreen />;
}
