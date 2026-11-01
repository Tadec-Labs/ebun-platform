import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { eventsEnabled } from "@/lib/feature-flags";
import { CreateEventForm } from "./create-event-form";

export const metadata: Metadata = {
  title: "Set up your event · SendEbun",
  description: "One link for every gift your guests want to give — a gift list, cash gifts and a live wall.",
};

export default function NewEventPage() {
  if (!eventsEnabled()) notFound();
  return <CreateEventForm />;
}
