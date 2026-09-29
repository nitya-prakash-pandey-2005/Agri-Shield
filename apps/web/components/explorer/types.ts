import type { AssetType, CropType } from "@agri-shield/types";
import type { RouterOutputs } from "@/lib/trpc";

export type Report = RouterOutputs["explorer"]["assess"];
export type Extras = NonNullable<Report["extras"]>;
export type ClimateData = RouterOutputs["explorer"]["climate"];
export type OutlookData = RouterOutputs["explorer"]["outlook"];
export type PublicReport = RouterOutputs["explorer"]["publicAssess"]["report"];
export type CompareRow = RouterOutputs["explorer"]["compare"][number];
export type SharedReport = RouterOutputs["explorer"]["getSharedReport"];

/** What the tabs render — assembled from live queries (workspace) or a frozen snapshot (/r/<id>). */
export interface ReportBundle {
  report: Report;
  climate: Pick<ClimateData, "history" | "drought"> & { ready: boolean; error?: string | null; queue?: ClimateData["queue"] } | null;
  outlook: Pick<OutlookData, "seasonal" | "projection" | "applied"> & { ready: boolean; seasonalError?: string | null; projectionError?: string | null } | null;
  assetType: AssetType;
  crop: CropType;
}

export interface Place {
  lat: number;
  lon: number;
  name?: string | null;
}

export const CROP_OPTIONS: { value: CropType; label: string }[] = [
  { value: "rice", label: "Rice" },
  { value: "wheat", label: "Wheat" },
  { value: "maize", label: "Maize" },
  { value: "sugarcane", label: "Sugarcane" },
  { value: "jute", label: "Jute" },
  { value: "coconut", label: "Coconut" },
  { value: "vegetables", label: "Vegetables" },
  { value: "sorghum", label: "Sorghum" },
  { value: "barley", label: "Barley" },
  { value: "potato", label: "Potato" },
  { value: "onion", label: "Onion" },
  { value: "cotton", label: "Cotton" },
  { value: "banana", label: "Banana" },
  { value: "mango", label: "Mango" },
];

export const ASSET_OPTIONS: { value: AssetType; label: string; group: "crop" | "facility" | "people" | "finance" }[] = [
  { value: "farm", label: "Farm", group: "crop" },
  { value: "field", label: "Field / plot", group: "crop" },
  { value: "insured_plot", label: "Insured plot", group: "finance" },
  { value: "loan", label: "Agri loan / collateral", group: "finance" },
  { value: "warehouse", label: "Warehouse", group: "facility" },
  { value: "processing_plant", label: "Processing plant", group: "facility" },
  { value: "port", label: "Port / terminal", group: "facility" },
  { value: "retail_outlet", label: "Retail outlet", group: "facility" },
  { value: "office", label: "Office / branch", group: "facility" },
  { value: "community", label: "Community / village", group: "people" },
];

export const assetGroup = (t: AssetType) => ASSET_OPTIONS.find((a) => a.value === t)?.group ?? "crop";
export const assetLabel = (t: AssetType) => ASSET_OPTIONS.find((a) => a.value === t)?.label ?? t;
export const cropLabel = (c: CropType) => CROP_OPTIONS.find((o) => o.value === c)?.label ?? c;

export const EXAMPLE_PLACES: (Place & { name: string; blurb: string })[] = [
  { name: "Barisal, Bangladesh", lat: 22.701, lon: 90.353, blurb: "Delta rice · floods & salinity" },
  { name: "Bến Tre, Vietnam", lat: 10.241, lon: 106.376, blurb: "Mekong coconut · salinity" },
  { name: "Jakarta, Indonesia", lat: -6.2, lon: 106.845, blurb: "Coastal megacity · floods" },
  { name: "Nairobi, Kenya", lat: -1.286, lon: 36.817, blurb: "Highlands · drought" },
  { name: "Ames, Iowa, USA", lat: 42.034, lon: -93.62, blurb: "Corn belt · heat & drought" },
  { name: "Amsterdam, Netherlands", lat: 52.372, lon: 4.9, blurb: "Below sea level · polders" },
];
