import type { Metadata } from "next";

import { StoryStateScreen } from "@/components/views/story-state-screen";

export const metadata: Metadata = {
  title: "Creator · Story State",
};

export default function StoryStatePage() {
  return <StoryStateScreen />;
}
