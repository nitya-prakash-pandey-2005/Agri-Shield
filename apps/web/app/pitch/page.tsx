import type { Metadata } from "next";
import "@/components/landing/landing.css";
import { PitchDeck } from "./PitchDeck";

export const metadata: Metadata = {
  title: "Pitch — Asian Hackathon for Green Future 2026",
  description:
    "Agri-SHIELD: 72-hour flood and saltwater-intrusion intelligence for farmers, governments and supply chains. Live demo, impact model, technology and business model.",
  alternates: { canonical: "/pitch" },
  openGraph: { title: "Agri-SHIELD — pitch", images: ["/og-image.png"] },
};

export default function PitchPage() {
  return <PitchDeck />;
}
