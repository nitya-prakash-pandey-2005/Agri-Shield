import { Apple, Banana, Bean, Carrot, Cigarette, Flower2, Leaf, LeafyGreen, Popcorn, Salad, Shrub, Sprout, TreePalm, Wheat, type LucideIcon } from "lucide-react";

export const CROPS = ["rice", "wheat", "maize", "sugarcane", "jute", "coconut", "vegetables", "sorghum", "barley", "potato", "onion", "cotton", "tobacco", "banana", "mango"] as const;
export type Crop = (typeof CROPS)[number];

export const CROP_ICON: Record<Crop, LucideIcon> = {
  rice: Wheat,
  wheat: Wheat,
  maize: Popcorn,
  sugarcane: Shrub,
  jute: Leaf,
  coconut: TreePalm,
  vegetables: Salad,
  sorghum: Sprout,
  barley: Wheat,
  potato: Bean,
  onion: Carrot,
  cotton: Flower2,
  tobacco: Cigarette,
  banana: Banana,
  mango: Apple,
};

export const CROP_TINT: Record<Crop, string> = {
  rice: "#a3e635",
  wheat: "#facc15",
  maize: "#fbbf24",
  sugarcane: "#4ade80",
  jute: "#86efac",
  coconut: "#34d399",
  vegetables: "#22c55e",
  sorghum: "#fb923c",
  barley: "#fde047",
  potato: "#d6a86c",
  onion: "#f0abfc",
  cotton: "#e2e8f0",
  tobacco: "#a8a29e",
  banana: "#fde68a",
  mango: "#fdba74",
};

export function CropIcon({ crop, size = 16, className }: { crop: string; size?: number; className?: string }) {
  const Icon = CROP_ICON[crop as Crop] ?? LeafyGreen;
  return <Icon size={size} className={className} style={{ color: CROP_TINT[crop as Crop] ?? "#86efac" }} aria-hidden />;
}
