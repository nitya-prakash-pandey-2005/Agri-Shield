/**
 * Demo geography — five climate-vulnerable deltas/coasts named in the spec.
 * Coordinates are real district centroids; exposure factors are calibrated
 * from published flood/salinity literature for each basin (approximate).
 */
import type { SupportedLanguage } from "@agri-shield/types";

export interface CountryDef {
  code: string;
  name: string;
  basin: string;
  currency: string;
  language: SupportedLanguage;
  ministry: string;
  ministryShort: string;
  center: [number, number]; // lat, lon
}

export interface DistrictDef {
  id: string;
  name: string;
  country: string; // country code
  lat: number;
  lon: number;
  population: number;
  /** 0-1 inherent flood exposure (low-lying, riverine, cyclone track) */
  floodExposure: number;
  /** 0-1 inherent salinity exposure (coastal distance, tidal rivers) */
  salinityExposure: number;
  coastDistanceKm: number;
  riverName: string;
  primaryCrops: string[];
}

export const COUNTRIES: CountryDef[] = [
  {
    code: "BD",
    name: "Bangladesh",
    basin: "Ganges–Brahmaputra Delta",
    currency: "BDT",
    language: "bn",
    ministry: "Ministry of Agriculture, Bangladesh",
    ministryShort: "MoA-BD",
    center: [23.2, 90.2],
  },
  {
    code: "VN",
    name: "Vietnam",
    basin: "Mekong Delta",
    currency: "VND",
    language: "vi",
    ministry: "Ministry of Agriculture and Rural Development (MARD)",
    ministryShort: "MARD",
    center: [10.0, 105.7],
  },
  {
    code: "PH",
    name: "Philippines",
    basin: "Central Luzon / Pampanga River Basin",
    currency: "PHP",
    language: "fil",
    ministry: "Department of Agriculture, Philippines",
    ministryShort: "DA-PH",
    center: [15.2, 120.8],
  },
  {
    code: "IN",
    name: "India",
    basin: "Odisha Coast / Mahanadi Delta",
    currency: "INR",
    language: "hi",
    ministry: "Odisha Dept. of Agriculture & Farmers' Empowerment",
    ministryShort: "DAFE-OD",
    center: [20.5, 86.3],
  },
  {
    code: "ID",
    name: "Indonesia",
    basin: "Java North Coast (Pantura)",
    currency: "IDR",
    language: "id",
    ministry: "Ministry of Agriculture, Indonesia (Kementan)",
    ministryShort: "Kementan",
    center: [-6.7, 109.6],
  },
];

export const DISTRICTS: DistrictDef[] = [
  // Bangladesh
  { id: "bd-barisal", name: "Barisal", country: "BD", lat: 22.7011, lon: 90.3637, population: 2_324_310, floodExposure: 0.78, salinityExposure: 0.52, coastDistanceKm: 62, riverName: "Kirtankhola", primaryCrops: ["rice", "jute"] },
  { id: "bd-khulna", name: "Khulna", country: "BD", lat: 22.8456, lon: 89.5403, population: 2_318_527, floodExposure: 0.84, salinityExposure: 0.88, coastDistanceKm: 38, riverName: "Rupsha", primaryCrops: ["rice", "vegetables"] },
  { id: "bd-satkhira", name: "Satkhira", country: "BD", lat: 22.7185, lon: 89.0705, population: 1_985_959, floodExposure: 0.72, salinityExposure: 0.93, coastDistanceKm: 22, riverName: "Betna", primaryCrops: ["rice", "vegetables"] },
  { id: "bd-patuakhali", name: "Patuakhali", country: "BD", lat: 22.3596, lon: 90.3299, population: 1_535_854, floodExposure: 0.86, salinityExposure: 0.81, coastDistanceKm: 18, riverName: "Lohalia", primaryCrops: ["rice", "coconut"] },
  { id: "bd-sylhet", name: "Sylhet", country: "BD", lat: 24.8949, lon: 91.8687, population: 3_434_188, floodExposure: 0.69, salinityExposure: 0.05, coastDistanceKm: 310, riverName: "Surma", primaryCrops: ["rice"] },
  // Vietnam
  { id: "vn-cantho", name: "Cần Thơ", country: "VN", lat: 10.0452, lon: 105.7469, population: 1_235_171, floodExposure: 0.64, salinityExposure: 0.55, coastDistanceKm: 75, riverName: "Hậu (Bassac)", primaryCrops: ["rice", "vegetables"] },
  { id: "vn-bentre", name: "Bến Tre", country: "VN", lat: 10.2434, lon: 106.3756, population: 1_288_463, floodExposure: 0.58, salinityExposure: 0.94, coastDistanceKm: 25, riverName: "Hàm Luông", primaryCrops: ["coconut", "rice"] },
  { id: "vn-soctrang", name: "Sóc Trăng", country: "VN", lat: 9.6025, lon: 105.9739, population: 1_199_653, floodExposure: 0.55, salinityExposure: 0.86, coastDistanceKm: 30, riverName: "Mỹ Thanh", primaryCrops: ["rice", "sugarcane"] },
  { id: "vn-camau", name: "Cà Mau", country: "VN", lat: 9.1769, lon: 105.1524, population: 1_194_476, floodExposure: 0.61, salinityExposure: 0.91, coastDistanceKm: 15, riverName: "Gành Hào", primaryCrops: ["rice"] },
  { id: "vn-angiang", name: "An Giang", country: "VN", lat: 10.5216, lon: 105.1259, population: 1_908_352, floodExposure: 0.81, salinityExposure: 0.18, coastDistanceKm: 140, riverName: "Tiền (Mekong)", primaryCrops: ["rice"] },
  // Philippines
  { id: "ph-pampanga", name: "Pampanga", country: "PH", lat: 15.0794, lon: 120.62, population: 2_437_709, floodExposure: 0.82, salinityExposure: 0.34, coastDistanceKm: 20, riverName: "Pampanga", primaryCrops: ["rice", "sugarcane"] },
  { id: "ph-bulacan", name: "Bulacan", country: "PH", lat: 14.7943, lon: 120.8799, population: 3_708_890, floodExposure: 0.77, salinityExposure: 0.41, coastDistanceKm: 12, riverName: "Angat", primaryCrops: ["rice", "vegetables"] },
  { id: "ph-nuevaecija", name: "Nueva Ecija", country: "PH", lat: 15.5784, lon: 121.1113, population: 2_310_134, floodExposure: 0.59, salinityExposure: 0.04, coastDistanceKm: 95, riverName: "Pampanga (upper)", primaryCrops: ["rice", "onion"] },
  { id: "ph-tarlac", name: "Tarlac", country: "PH", lat: 15.4755, lon: 120.5963, population: 1_503_456, floodExposure: 0.52, salinityExposure: 0.03, coastDistanceKm: 70, riverName: "Tarlac", primaryCrops: ["rice", "sugarcane", "maize"] },
  // India (Odisha)
  { id: "in-kendrapara", name: "Kendrapara", country: "IN", lat: 20.5, lon: 86.4167, population: 1_440_361, floodExposure: 0.83, salinityExposure: 0.77, coastDistanceKm: 20, riverName: "Brahmani", primaryCrops: ["rice", "jute"] },
  { id: "in-jagatsinghpur", name: "Jagatsinghpur", country: "IN", lat: 20.2549, lon: 86.1706, population: 1_136_971, floodExposure: 0.79, salinityExposure: 0.72, coastDistanceKm: 18, riverName: "Mahanadi", primaryCrops: ["rice", "coconut"] },
  { id: "in-balasore", name: "Balasore", country: "IN", lat: 21.4942, lon: 86.9317, population: 2_320_529, floodExposure: 0.71, salinityExposure: 0.58, coastDistanceKm: 16, riverName: "Budhabalanga", primaryCrops: ["rice", "vegetables"] },
  { id: "in-puri", name: "Puri", country: "IN", lat: 19.8135, lon: 85.8312, population: 1_698_730, floodExposure: 0.66, salinityExposure: 0.63, coastDistanceKm: 8, riverName: "Kushabhadra", primaryCrops: ["rice", "coconut"] },
  // Indonesia (Java north coast)
  { id: "id-demak", name: "Demak", country: "ID", lat: -6.8943, lon: 110.6387, population: 1_203_956, floodExposure: 0.85, salinityExposure: 0.79, coastDistanceKm: 10, riverName: "Tuntang", primaryCrops: ["rice", "vegetables"] },
  { id: "id-pekalongan", name: "Pekalongan", country: "ID", lat: -6.8898, lon: 109.6746, population: 968_821, floodExposure: 0.8, salinityExposure: 0.74, coastDistanceKm: 6, riverName: "Kupang", primaryCrops: ["rice"] },
  { id: "id-indramayu", name: "Indramayu", country: "ID", lat: -6.3373, lon: 108.3258, population: 1_834_434, floodExposure: 0.68, salinityExposure: 0.61, coastDistanceKm: 14, riverName: "Cimanuk", primaryCrops: ["rice", "mango"] },
  { id: "id-semarang", name: "Semarang", country: "ID", lat: -6.9932, lon: 110.4203, population: 1_653_524, floodExposure: 0.74, salinityExposure: 0.66, coastDistanceKm: 5, riverName: "Garang", primaryCrops: ["rice", "vegetables"] },
];

export const countryByCode = (code: string) => COUNTRIES.find((c) => c.code === code)!;
export const districtById = (id: string) => DISTRICTS.find((d) => d.id === id);
