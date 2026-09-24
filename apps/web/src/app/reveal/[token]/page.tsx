import type { Metadata } from "next";
import { getRevealView } from "@/lib/reveal/get-reveal-view";
import { RevealExperience } from "./reveal-experience";

export const metadata: Metadata = {
  title: "A gift for you — Ebun",
  description: "Someone sent you something.",
};

export default async function RevealPage({ params }: PageProps<"/reveal/[token]">) {
  const { token } = await params;
  const payload = await getRevealView(token);

  return <RevealExperience token={token} initial={payload} />;
}
