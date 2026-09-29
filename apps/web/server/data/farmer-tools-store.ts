/**
 * Farmer tools state — irrigation logs, Crop Doctor cases, farm ledger,
 * price alerts, expert questions and insurance enrolment requests.
 *
 * Kept beside (not inside) store.ts so the farmer-tools module can evolve on
 * its own. It is bound to the main store's seed: when the demo store is reset
 * (tests, daily reset) this state is re-seeded too.
 */
import { DAY, getStore, nextId } from "./store";
import { restore, track } from "../persist";

export interface IrrigationLogRecord {
  id: string;
  farmerId: string;
  fieldId: string;
  date: string; // YYYY-MM-DD
  mm: number;
  note: string | null;
  createdAt: Date;
}

export interface DoctorCaseRecord {
  id: string;
  farmerId: string;
  fieldId: string | null;
  crop: string;
  part: string;
  symptoms: string[];
  /** top ranked causes at the time of diagnosis */
  results: { causeId: string; score: number }[];
  photo: string | null; // compressed data URL
  note: string | null;
  status: "open" | "treated" | "resolved";
  createdAt: Date;
}

export type LedgerCategory =
  | "seed"
  | "fertiliser"
  | "pesticide"
  | "labour"
  | "irrigation"
  | "machinery"
  | "land"
  | "transport"
  | "insurance"
  | "other_expense"
  | "sale"
  | "subsidy"
  | "insurance_payout"
  | "other_income";

export const EXPENSE_CATEGORIES = ["seed", "fertiliser", "pesticide", "labour", "irrigation", "machinery", "land", "transport", "insurance", "other_expense"] as const;
export const INCOME_CATEGORIES = ["sale", "subsidy", "insurance_payout", "other_income"] as const;

export interface LedgerEntryRecord {
  id: string;
  farmerId: string;
  season: string;
  fieldId: string | null;
  date: string; // YYYY-MM-DD
  kind: "expense" | "income";
  category: LedgerCategory;
  amount: number; // local currency
  note: string | null;
  /** seeded example rows so the ledger is not empty on first run */
  sample: boolean;
  createdAt: Date;
}

export interface PriceAlertRecord {
  id: string;
  farmerId: string;
  commodity: string; // commodity key, e.g. "rice"
  direction: "above" | "below";
  target: number; // local currency per unit
  unit: string;
  createdAt: Date;
  triggeredAt: Date | null;
  lastPrice: number | null;
  active: boolean;
}

export interface QuestionRecord {
  id: string;
  farmerId: string;
  farmerName: string;
  districtId: string;
  orgId: string;
  crop: string | null;
  text: string;
  photo: string | null;
  createdAt: Date;
  status: "open" | "answered";
  answers: { id: string; by: string; byName: string; role: string; text: string; at: Date }[];
}

export interface InsuranceRequestRecord {
  id: string;
  farmerId: string;
  workspaceId: string;
  fieldIds: string[];
  crop: string;
  areaHa: number;
  sumInsuredUsd: number;
  premiumUsd: number;
  phone: string | null;
  status: "requested" | "contacted" | "enrolled" | "declined";
  notificationId: string | null;
  createdAt: Date;
}

export interface FarmToolsState {
  seededAt: Date;
  irrigationLogs: IrrigationLogRecord[];
  doctorCases: DoctorCaseRecord[];
  ledger: LedgerEntryRecord[];
  priceAlerts: PriceAlertRecord[];
  questions: QuestionRecord[];
  insuranceRequests: InsuranceRequestRecord[];
}

const g = globalThis as unknown as { __agriFarmTools?: FarmToolsState };

const iso = (d: Date) => d.toISOString().slice(0, 10);

function seedState(): FarmToolsState {
  const s = getStore();
  const now = Date.now();
  const st: FarmToolsState = { seededAt: s.seededAt, irrigationLogs: [], doctorCases: [], ledger: [], priceAlerts: [], questions: [], insuranceRequests: [] };
  const demo = s.farmers.find((f) => f.id === "farmer-000");
  if (!demo) return st;
  const fields = s.fields.filter((f) => f.farmerId === demo.id);
  const rice = fields.find((f) => f.cropType === "rice");
  const jute = fields.find((f) => f.cropType === "jute");
  const add = (e: Omit<LedgerEntryRecord, "id" | "farmerId" | "sample" | "createdAt">) =>
    st.ledger.push({ ...e, id: nextId("led"), farmerId: demo.id, sample: true, createdAt: new Date(now) });

  // Example ledger (BDT) — typical Barisal costs: subsidised fertiliser prices (urea/TSP 27, MoP 20 BDT/kg),
  // day labour ~600 BDT. Rows are flagged `sample` and can be deleted.
  if (rice) {
    const p = rice.plantingDate.getTime();
    const ha = rice.areaHa;
    add({ season: "Aman 2026", fieldId: rice.id, date: iso(new Date(p - 25 * DAY)), kind: "expense", category: "seed", amount: Math.round(ha * 30 * 60), note: "BRRI dhan 52 seed, 30 kg/ha" });
    add({ season: "Aman 2026", fieldId: rice.id, date: iso(new Date(p - 2 * DAY)), kind: "expense", category: "machinery", amount: Math.round(ha * 5500), note: "Power tiller land preparation" });
    add({ season: "Aman 2026", fieldId: rice.id, date: iso(new Date(p)), kind: "expense", category: "labour", amount: Math.round(ha * 15 * 600), note: "Transplanting, 15 person-days/ha" });
    add({ season: "Aman 2026", fieldId: rice.id, date: iso(new Date(p)), kind: "expense", category: "fertiliser", amount: Math.round(ha * (60 * 27 + 75 * 20 + 55 * 15)), note: "Basal TSP 60 kg/ha, MoP 75 kg/ha, gypsum 55 kg/ha" });
    add({ season: "Aman 2026", fieldId: rice.id, date: iso(new Date(p + 20 * DAY)), kind: "expense", category: "fertiliser", amount: Math.round(ha * 80 * 27), note: "Urea top-dress #1, 80 kg/ha" });
    add({ season: "Aman 2026", fieldId: rice.id, date: iso(new Date(p + 28 * DAY)), kind: "expense", category: "labour", amount: Math.round(ha * 10 * 600), note: "Hand weeding" });
  }
  if (jute) {
    const p = jute.plantingDate.getTime();
    const ha = jute.areaHa;
    add({ season: "Kharif-1 2026", fieldId: jute.id, date: iso(new Date(p)), kind: "expense", category: "seed", amount: Math.round(ha * 7 * 250), note: "Tossa jute seed, 7 kg/ha" });
    add({ season: "Kharif-1 2026", fieldId: jute.id, date: iso(new Date(p)), kind: "expense", category: "fertiliser", amount: Math.round(ha * (185 * 27 + 30 * 27 + 55 * 20)), note: "Urea 185, TSP 30, MoP 55 kg/ha" });
    add({ season: "Kharif-1 2026", fieldId: jute.id, date: iso(new Date(p + 30 * DAY)), kind: "expense", category: "labour", amount: Math.round(ha * 30 * 600), note: "Thinning and weeding" });
  }
  // Last Boro season — a finished example with a sale, so profit is visible.
  const boroYear = new Date(now).getFullYear();
  if (rice) {
    const ha = rice.areaHa;
    add({ season: `Boro ${boroYear}`, fieldId: rice.id, date: `${boroYear}-01-10`, kind: "expense", category: "seed", amount: Math.round(ha * 35 * 60), note: "BRRI dhan 67 (salt-tolerant) seed" });
    add({ season: `Boro ${boroYear}`, fieldId: rice.id, date: `${boroYear}-01-20`, kind: "expense", category: "fertiliser", amount: Math.round(ha * (260 * 27 + 100 * 27 + 120 * 20)), note: "Urea 260, TSP 100, MoP 120 kg/ha" });
    add({ season: `Boro ${boroYear}`, fieldId: rice.id, date: `${boroYear}-02-15`, kind: "expense", category: "irrigation", amount: Math.round(ha * 12000), note: "Shallow tube-well water charge" });
    add({ season: `Boro ${boroYear}`, fieldId: rice.id, date: `${boroYear}-01-05`, kind: "expense", category: "machinery", amount: Math.round(ha * 8000), note: "Power tiller ploughing and puddling" });
    add({ season: `Boro ${boroYear}`, fieldId: rice.id, date: `${boroYear}-01-22`, kind: "expense", category: "labour", amount: Math.round(ha * 60 * 600), note: "Seedbed, transplanting, weeding, carrying" });
    add({ season: `Boro ${boroYear}`, fieldId: rice.id, date: `${boroYear}-03-10`, kind: "expense", category: "pesticide", amount: Math.round(ha * 3000), note: "Stem borer spray (after threshold)" });
    add({ season: `Boro ${boroYear}`, fieldId: rice.id, date: `${boroYear}-05-05`, kind: "expense", category: "machinery", amount: Math.round(ha * 7000), note: "Combine harvester hire" });
    add({ season: `Boro ${boroYear}`, fieldId: rice.id, date: `${boroYear}-05-12`, kind: "income", category: "sale", amount: Math.round(ha * 5.8 * 1000 * 30), note: "Paddy 5.8 t/ha sold at 30 BDT/kg (1,200 BDT/maund)" });
  }

  // One answered question from the district officer, so the flow is visible.
  const officer = s.users.find((u) => u.id === "user-officer-barisal");
  const u = s.users.find((x) => x.id === demo.userId);
  const district = s.districts.find((d) => d.id === demo.districtId);
  if (officer && district) {
    st.questions.push({
      id: nextId("qst"),
      farmerId: demo.id,
      farmerName: u?.name ?? "Farmer",
      districtId: district.id,
      orgId: district.orgId,
      crop: "rice",
      text: "Leaf tips on my Aman seedlings are turning white after the tidal water came into the field. Should I apply more urea?",
      photo: null,
      createdAt: new Date(now - 6 * DAY),
      status: "answered",
      answers: [
        {
          id: nextId("ans"),
          by: officer.id,
          byName: officer.name,
          role: officer.role,
          text: "White, burnt leaf tips after tidal intrusion are usually salt injury, not nitrogen shortage. Do not add extra urea now. Keep tidal water out, flush the field with canal or rain water if the water EC is below 2 dS/m, and apply 30 kg/ha MoP. For the next Boro season, consider BRRI dhan 67 or BINA dhan 10.",
          at: new Date(now - 5 * DAY),
        },
      ],
    });
  }
  return st;
}

const FARM_TOOLS_VERSION = 1;
track("farmer-tools", FARM_TOOLS_VERSION, () => g.__agriFarmTools);

export function farmTools(): FarmToolsState {
  const s = getStore();
  g.__agriFarmTools ??= restore<FarmToolsState>("farmer-tools", FARM_TOOLS_VERSION, (v) => (v as FarmToolsState).seededAt instanceof Date && Array.isArray((v as FarmToolsState).ledger));
  // Compare by time, not identity: a restored snapshot carries its own Date instance.
  if (!g.__agriFarmTools || g.__agriFarmTools.seededAt.getTime() !== s.seededAt.getTime()) g.__agriFarmTools = seedState();
  return g.__agriFarmTools;
}
