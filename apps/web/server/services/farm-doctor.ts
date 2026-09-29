/**
 * Crop Doctor — symptom-based diagnosis knowledge base + ranking.
 *
 * Content follows the extension literature farmers are already taught with:
 * IRRI Rice Knowledge Bank / Rice Doctor, BRRI "Adhunik Dhaner Chash", BARI/BJRI
 * crop guides, CIMMYT (wheat blast, fall armyworm) and FAO IPM field guides.
 * Chemical names are generic active ingredients; farmers are always told to follow
 * the product label and ask the local extension officer.
 *
 * Pure data + functions (no server imports) so the wizard also runs offline in
 * the browser.
 */

export type Part = "leaf" | "stem" | "root" | "grain" | "whole";
export type CauseType = "disease" | "pest" | "abiotic" | "nutrient";

export interface Symptom {
  id: string;
  parts: Part[];
  crops: string[] | "*";
  label: string;
  /** icon glyph id for the illustrated picker */
  glyph: string;
}

export const SYMPTOMS: Symptom[] = [
  { id: "diamond_spots", parts: ["leaf"], crops: ["rice", "wheat"], label: "Diamond / eye-shaped spots with grey centre and brown edge", glyph: "diamond" },
  { id: "brown_oval_spots", parts: ["leaf", "grain"], crops: ["rice", "maize", "wheat"], label: "Many small oval brown spots (like sesame seeds)", glyph: "dots" },
  { id: "yellow_wavy_edge", parts: ["leaf"], crops: ["rice"], label: "Leaf edge turns yellow-white from the tip, wavy border", glyph: "edge" },
  { id: "white_burnt_tips", parts: ["leaf"], crops: "*", label: "Leaf tips white or burnt, older leaves first", glyph: "tipburn" },
  { id: "salt_crust", parts: ["whole", "root"], crops: "*", label: "White crust on soil, patchy stunted growth", glyph: "crust" },
  { id: "rotting_after_flood", parts: ["whole", "leaf", "stem"], crops: "*", label: "Plants rotting, slimy or lodged after being under water", glyph: "flood" },
  { id: "old_leaves_yellow", parts: ["leaf", "whole"], crops: "*", label: "Older leaves evenly pale / yellow, plants thin", glyph: "yellow" },
  { id: "orange_brown_margins", parts: ["leaf"], crops: "*", label: "Orange-brown leaf margins and tips on older leaves", glyph: "margin" },
  { id: "dusty_brown_young", parts: ["leaf", "whole"], crops: ["rice", "maize", "wheat"], label: "Dusty brown spots on young leaves, stunted uneven growth", glyph: "dust" },
  { id: "purple_dark_stunted", parts: ["leaf", "whole"], crops: "*", label: "Dark green or purplish leaves, stunted, few tillers", glyph: "purple" },
  { id: "dead_heart", parts: ["stem"], crops: ["rice", "maize", "sugarcane"], label: "Central shoot dries and pulls out easily (dead heart)", glyph: "deadheart" },
  { id: "white_head", parts: ["grain"], crops: ["rice"], label: "Whole panicle white and empty (white head)", glyph: "whitehead" },
  { id: "bleached_spike", parts: ["grain"], crops: ["wheat"], label: "Part of the ear bleached white above a black point on the stem", glyph: "whitehead" },
  { id: "folded_leaves", parts: ["leaf"], crops: ["rice"], label: "Leaves folded lengthwise with white scraped streaks", glyph: "fold" },
  { id: "hopper_burn", parts: ["whole", "stem"], crops: ["rice"], label: "Round patches of plants drying, brown insects at the base", glyph: "patch" },
  { id: "sheath_lesion", parts: ["stem"], crops: ["rice"], label: "Grey-green oval blotches on the sheath near the water line", glyph: "sheath" },
  { id: "orange_pustules", parts: ["leaf", "stem"], crops: ["wheat", "maize"], label: "Orange / brown powdery pustules that rub off", glyph: "pustule" },
  { id: "ragged_holes_whorl", parts: ["leaf"], crops: ["maize", "sorghum"], label: "Ragged holes in the whorl with sawdust-like droppings", glyph: "holes" },
  { id: "holes_in_fruit", parts: ["grain", "stem"], crops: ["vegetables"], label: "Holes in fruit / wilting shoot tips with a caterpillar inside", glyph: "fruithole" },
  { id: "wilting_rot_base", parts: ["whole", "stem", "root"], crops: "*", label: "Whole plant wilts; stem base dark or rotten", glyph: "wilt" },
  { id: "purple_lesions_onion", parts: ["leaf"], crops: ["onion"], label: "Purple-brown oval lesions with yellow halo on leaves", glyph: "purplespot" },
  { id: "black_stem_lesion", parts: ["stem"], crops: ["jute"], label: "Black-brown lesions on the stem, plants break", glyph: "blackstem" },
  { id: "leaf_rolling_drought", parts: ["leaf", "whole"], crops: "*", label: "Leaves roll or droop in the afternoon, soil cracked / dry", glyph: "roll" },
  { id: "yellow_mosaic", parts: ["leaf"], crops: ["jute", "vegetables"], label: "Yellow-green mosaic pattern, curled young leaves", glyph: "mosaic" },
];

export interface Cause {
  id: string;
  name: string;
  type: CauseType;
  crops: string[] | "*";
  /** symptom id → weight (0-1) */
  signs: Record<string, number>;
  /** context boosts */
  context?: { humid?: number; flood?: number; salinity?: number; dry?: number; hot?: number };
  summary: string;
  treatment: string[];
  prevention: string[];
  callOfficer: string;
  urgency: "low" | "medium" | "high";
  source: string;
}

export const CAUSES: Cause[] = [
  {
    id: "blast",
    name: "Blast (Magnaporthe oryzae)",
    type: "disease",
    crops: ["rice"],
    signs: { diamond_spots: 1, white_head: 0.35, brown_oval_spots: 0.2 },
    context: { humid: 0.25 },
    summary: "Fungal disease favoured by cool nights, long leaf wetness and too much nitrogen. Neck blast at flowering can empty the panicles.",
    treatment: ["Stop urea top-dressing until the disease is controlled.", "Keep the field flooded (dry fields make blast worse).", "Spray tricyclazole 75 WP (about 0.6 g per litre) or a label-approved azoxystrobin mix; repeat after 7–10 days if spots keep spreading, and spray at booting if neck blast is common locally."],
    prevention: ["Use blast-tolerant varieties and clean seed.", "Split nitrogen into 3 doses; avoid late heavy urea.", "Burn or remove infected straw and stubble."],
    callOfficer: "Call if spots are on the panicle neck or more than 1 in 10 leaves is affected.",
    urgency: "high",
    source: "IRRI Rice Knowledge Bank; BRRI",
  },
  {
    id: "brown_spot",
    name: "Brown spot (Bipolaris oryzae)",
    type: "disease",
    crops: ["rice"],
    signs: { brown_oval_spots: 1, dusty_brown_young: 0.2, old_leaves_yellow: 0.2 },
    context: { humid: 0.15, dry: 0.1 },
    summary: "A sign of hungry soil — common where potassium, silicon or nitrogen is low and in water-stressed fields.",
    treatment: ["Apply balanced fertiliser — especially potash (MoP) if you skipped it.", "If more than 1 in 4 leaves is spotted near flowering, spray a label-approved propiconazole or mancozeb product."],
    prevention: ["Treat seed with a fungicide or hot water (52–54 °C for 10 minutes).", "Use a soil test; apply MoP and organic matter.", "Avoid water stress."],
    callOfficer: "Call if grain is discoloured over a large area.",
    urgency: "medium",
    source: "IRRI Rice Knowledge Bank",
  },
  {
    id: "blb",
    name: "Bacterial leaf blight (Xanthomonas oryzae)",
    type: "disease",
    crops: ["rice"],
    signs: { yellow_wavy_edge: 1, white_burnt_tips: 0.25, wilting_rot_base: 0.2 },
    context: { flood: 0.25, humid: 0.2 },
    summary: "Bacterial disease that spreads with flood water, wind-driven rain and wounds. No spray cures it.",
    treatment: ["Drain the field for 3–4 days, then re-irrigate.", "Stop urea; apply potash (about 30 kg/ha MoP).", "Do not spray antibiotics or copper unless your officer says so — they rarely pay off."],
    prevention: ["Use resistant varieties (e.g. those with Xa21/xa13 genes).", "Avoid clipping seedling tips; keep bunds clean.", "Balanced nitrogen."],
    callOfficer: "Call if more than 1 in 5 hills show symptoms — your officer may confirm with a lab test.",
    urgency: "high",
    source: "IRRI Rice Knowledge Bank; BRRI",
  },
  {
    id: "salt_injury",
    name: "Salt injury (soil / water salinity)",
    type: "abiotic",
    crops: "*",
    signs: { white_burnt_tips: 1, salt_crust: 1, purple_dark_stunted: 0.15, leaf_rolling_drought: 0.2 },
    context: { salinity: 0.5, dry: 0.15 },
    summary: "Salty irrigation or tidal water damages the roots; leaf tips whiten and burn, growth is patchy. Worst in the dry season in coastal fields.",
    treatment: ["Stop using tidal / river water with EC above 2 dS/m; use rain, pond or canal water.", "Flush the field with fresh water and drain it out (leaching).", "Apply potash (MoP about 30 kg/ha) and gypsum; do not add extra urea."],
    prevention: ["Grow salt-tolerant varieties (e.g. BRRI dhan 67, BINA dhan 10, OM 5451).", "Transplant older, stronger seedlings; plant early in the dry season.", "Keep a mulch on vegetables; store rain water in a pond."],
    callOfficer: "Call if the whole field is affected — ask for a soil / water EC test.",
    urgency: "high",
    source: "IRRI; BRRI coastal agriculture guidelines",
  },
  {
    id: "submergence",
    name: "Submergence / flood damage",
    type: "abiotic",
    crops: "*",
    signs: { rotting_after_flood: 1, old_leaves_yellow: 0.2, wilting_rot_base: 0.3 },
    context: { flood: 0.6 },
    summary: "Plants under water for days run out of oxygen and energy. Most rice dies after 7 days fully under water unless it is a Sub1 variety.",
    treatment: ["Let the water drain out slowly — sudden exposure to sun kills weak plants.", "Wait 7–10 days after the water goes before applying urea, then top-dress about 1/3 of the normal dose plus MoP.", "Gap-fill with spare seedlings from a high seedbed; re-sow with a short-duration variety if more than half the hills died."],
    prevention: ["Use submergence-tolerant (Sub1) varieties such as BRRI dhan 51/52, Swarna-Sub1.", "Keep a raised community seedbed with spare seedlings.", "Clear drains before heavy rain alerts."],
    callOfficer: "Call to report the loss (for relief and insurance) if more than 30% of the crop is damaged.",
    urgency: "high",
    source: "IRRI; FAO",
  },
  {
    id: "stem_borer",
    name: "Stem borer (yellow stem borer)",
    type: "pest",
    crops: ["rice", "maize", "sugarcane"],
    signs: { dead_heart: 1, white_head: 1 },
    summary: "Caterpillars bore into the stem: 'dead heart' in young plants, 'white head' (empty panicles) at heading.",
    treatment: ["Pull out and destroy dead hearts; collect egg masses on leaf tips.", "Put bamboo perches (about 10 per bigha / 75 per ha) for birds; use light traps.", "Spray only if more than 10% dead hearts or 5% white heads: a label-approved chlorantraniliprole or cartap product."],
    prevention: ["Clip seedling tips before transplanting (removes eggs).", "Harvest close to the ground; plough stubble.", "Avoid early broad-spectrum sprays that kill spiders and wasps."],
    callOfficer: "Call if white heads exceed 5% of hills.",
    urgency: "medium",
    source: "IRRI Rice Knowledge Bank; BRRI",
  },
  {
    id: "leaf_folder",
    name: "Rice leaf folder",
    type: "pest",
    crops: ["rice"],
    signs: { folded_leaves: 1 },
    summary: "Caterpillars fold leaves and scrape the green tissue. Usually looks worse than it is.",
    treatment: ["No spray needed unless more than 1 in 4 flag leaves are damaged after flowering starts.", "Pass a rope over the crop to dislodge larvae; use bird perches."],
    prevention: ["Balanced nitrogen; avoid early sprays that kill natural enemies."],
    callOfficer: "Call if damage reaches the flag leaves on many hills.",
    urgency: "low",
    source: "IRRI Rice Knowledge Bank",
  },
  {
    id: "bph",
    name: "Brown planthopper (hopper burn)",
    type: "pest",
    crops: ["rice"],
    signs: { hopper_burn: 1, wilting_rot_base: 0.3 },
    context: { humid: 0.15 },
    summary: "Tiny brown insects at the base suck sap; plants dry in round patches ('hopper burn') within days.",
    treatment: ["Drain the field for 3–4 days; open the canopy by separating hills.", "Stop urea.", "If more than 10 hoppers per hill: spray a label-approved pymetrozine or dinotefuran product at the plant base."],
    prevention: ["Avoid excess nitrogen and dense planting.", "Do not spray pyrethroids early — they cause BPH outbreaks."],
    callOfficer: "Call immediately if patches are spreading — neighbours must act together.",
    urgency: "high",
    source: "IRRI; BRRI",
  },
  {
    id: "sheath_blight",
    name: "Sheath blight (Rhizoctonia solani)",
    type: "disease",
    crops: ["rice"],
    signs: { sheath_lesion: 1 },
    context: { humid: 0.25 },
    summary: "Fungus spreading from the water line up the sheath in dense, heavily fertilised crops.",
    treatment: ["Reduce nitrogen; drain briefly.", "If lesions reach the upper leaves before flowering: spray a label-approved hexaconazole or validamycin product."],
    prevention: ["Wider spacing; remove weeds from bunds; balanced fertiliser."],
    callOfficer: "Call if lesions reach the flag leaf.",
    urgency: "medium",
    source: "IRRI Rice Knowledge Bank",
  },
  {
    id: "n_deficiency",
    name: "Nitrogen deficiency",
    type: "nutrient",
    crops: "*",
    signs: { old_leaves_yellow: 1, purple_dark_stunted: 0.1 },
    summary: "Older leaves turn pale yellow first because the plant moves nitrogen to new leaves.",
    treatment: ["Top-dress urea now (rice: about 40–60 kg/ha per split; use a Leaf Colour Chart — apply when leaves are lighter than panel 3–4).", "Apply into moist soil / shallow water and avoid rain-wash."],
    prevention: ["Split urea into 2–3 doses matched to crop stage.", "Add compost or green manure."],
    callOfficer: "Call if yellowing continues 10 days after urea.",
    urgency: "medium",
    source: "IRRI Leaf Colour Chart; BARC Fertilizer Recommendation Guide 2018",
  },
  {
    id: "k_deficiency",
    name: "Potassium deficiency",
    type: "nutrient",
    crops: "*",
    signs: { orange_brown_margins: 1, brown_oval_spots: 0.25, white_burnt_tips: 0.2 },
    summary: "Older leaves turn orange-brown from the tips and margins; plants lodge and get more disease.",
    treatment: ["Apply MoP (muriate of potash): about 30–50 kg/ha now, more on sandy soil."],
    prevention: ["Apply MoP every season; return straw to the field."],
    callOfficer: "Ask for a soil test if this happens every season.",
    urgency: "low",
    source: "IRRI Nutrient Manager; BARC FRG 2018",
  },
  {
    id: "zn_deficiency",
    name: "Zinc deficiency ('khaira')",
    type: "nutrient",
    crops: ["rice", "maize", "wheat"],
    signs: { dusty_brown_young: 1, purple_dark_stunted: 0.2 },
    context: { flood: 0.1 },
    summary: "Common in continuously flooded, high-pH or saline soils: dusty brown spots on young leaves, stunted and uneven crop 2–4 weeks after transplanting.",
    treatment: ["Spray 0.5% zinc sulphate (5 g per litre) with 0.25% lime, or broadcast zinc sulphate monohydrate about 10 kg/ha."],
    prevention: ["Apply zinc sulphate every 2–3 seasons as basal fertiliser.", "Dry the field briefly (AWD) to improve zinc availability."],
    callOfficer: "Call if the crop does not green up within 10 days.",
    urgency: "medium",
    source: "IRRI; BRRI",
  },
  {
    id: "p_deficiency",
    name: "Phosphorus deficiency",
    type: "nutrient",
    crops: "*",
    signs: { purple_dark_stunted: 1 },
    summary: "Stunted, dark-green or purplish plants with few tillers or roots, often on acid or cold soils.",
    treatment: ["Apply TSP or DAP as early as possible (basal is best); about 50–100 kg/ha TSP."],
    prevention: ["Apply phosphorus at planting every season; lime acid soils."],
    callOfficer: "Ask for a soil test.",
    urgency: "low",
    source: "IRRI Nutrient Manager; BARC FRG 2018",
  },
  {
    id: "wheat_rust",
    name: "Wheat / maize rust",
    type: "disease",
    crops: ["wheat", "maize"],
    signs: { orange_pustules: 1 },
    context: { humid: 0.2 },
    summary: "Fungal pustules that rub off like rust powder; spreads by wind.",
    treatment: ["Spray a label-approved propiconazole or tebuconazole product at first sign; repeat after 15 days if needed."],
    prevention: ["Grow resistant varieties; sow on time."],
    callOfficer: "Call if pustules appear on the flag leaf before grain filling.",
    urgency: "medium",
    source: "CIMMYT",
  },
  {
    id: "wheat_blast",
    name: "Wheat blast",
    type: "disease",
    crops: ["wheat"],
    signs: { bleached_spike: 1, diamond_spots: 0.4 },
    context: { humid: 0.3, hot: 0.2 },
    summary: "Arrived in Bangladesh in 2016; warm, humid weather at heading bleaches the ear within days.",
    treatment: ["Spray tebuconazole + trifloxystrobin (label rate) at heading and again 12–15 days later — prevention works far better than cure."],
    prevention: ["Grow BARI Gom 33; use treated seed; sow by early December so heading avoids warm humid spells."],
    callOfficer: "Report immediately — wheat blast is a notifiable disease in several districts.",
    urgency: "high",
    source: "CIMMYT; BWMRI",
  },
  {
    id: "faw",
    name: "Fall armyworm",
    type: "pest",
    crops: ["maize", "sorghum"],
    signs: { ragged_holes_whorl: 1, dead_heart: 0.2 },
    summary: "Invasive caterpillar (since 2018 in South Asia) eating inside the maize whorl.",
    treatment: ["Hand-pick egg masses and larvae; put sand + lime or ash into the whorl.", "If more than 1 in 5 plants damaged: spray a label-approved emamectin benzoate or spinetoram product into the whorl."],
    prevention: ["Plant early and at the same time as neighbours; intercrop with pulses; install pheromone traps."],
    callOfficer: "Report — district officers track fall armyworm.",
    urgency: "medium",
    source: "FAO FAW Global Action; CIMMYT",
  },
  {
    id: "fsb",
    name: "Fruit & shoot borer",
    type: "pest",
    crops: ["vegetables"],
    signs: { holes_in_fruit: 1 },
    summary: "Caterpillar bores into shoot tips and fruit (eggplant, okra, tomato).",
    treatment: ["Cut and destroy wilted shoots and holed fruit every week.", "Use pheromone traps (about 40 per acre / 100 per ha)."],
    prevention: ["Net nurseries; rotate crops; avoid calendar spraying."],
    callOfficer: "Call if more than 1 in 10 fruits is damaged despite weekly cleaning.",
    urgency: "medium",
    source: "BARI; AVRDC / WorldVeg IPM",
  },
  {
    id: "wilt_rot",
    name: "Wilt / stem rot (fungal or bacterial)",
    type: "disease",
    crops: "*",
    signs: { wilting_rot_base: 1, black_stem_lesion: 0.3 },
    context: { flood: 0.2, humid: 0.2 },
    summary: "Soil-borne fungi or bacteria block the water vessels; worst in waterlogged or poorly drained soil.",
    treatment: ["Remove and burn wilted plants with the soil around the roots.", "Improve drainage; stop overhead watering.", "Drench healthy plants nearby with a Trichoderma bio-fungicide or label-approved copper/carbendazim product."],
    prevention: ["Raised beds; crop rotation; seed treatment; resistant varieties."],
    callOfficer: "Call if many plants wilt within a week.",
    urgency: "medium",
    source: "FAO IPM; BARI",
  },
  {
    id: "purple_blotch",
    name: "Purple blotch (onion)",
    type: "disease",
    crops: ["onion"],
    signs: { purple_lesions_onion: 1 },
    context: { humid: 0.3 },
    summary: "Fungal leaf disease in humid weather; can cut bulb yield by half.",
    treatment: ["Spray a label-approved mancozeb or iprodione product every 10–15 days in humid weather."],
    prevention: ["Healthy seed; wider spacing; avoid overhead irrigation late in the day."],
    callOfficer: "Call if lesions cover more than a quarter of the leaves.",
    urgency: "medium",
    source: "BARI; ICAR-DOGR",
  },
  {
    id: "jute_stem_rot",
    name: "Jute stem rot (Macrophomina)",
    type: "disease",
    crops: ["jute"],
    signs: { black_stem_lesion: 1, wilting_rot_base: 0.4 },
    context: { humid: 0.2, flood: 0.15 },
    summary: "Black lesions on the stem; plants break at the lesion. Worse in waterlogged or nutrient-poor fields.",
    treatment: ["Remove infected plants; improve drainage.", "Spray a label-approved carbendazim or mancozeb product if spreading."],
    prevention: ["Treat seed; balanced NPK with potash; rotate with rice."],
    callOfficer: "Call if more than 1 in 10 plants is affected.",
    urgency: "medium",
    source: "BJRI",
  },
  {
    id: "mosaic_virus",
    name: "Yellow mosaic / leaf curl virus",
    type: "disease",
    crops: ["jute", "vegetables"],
    signs: { yellow_mosaic: 1 },
    summary: "Virus carried by whiteflies; infected plants cannot be cured.",
    treatment: ["Pull out and destroy infected plants early.", "Control whiteflies with yellow sticky traps; spray neem oil."],
    prevention: ["Use tolerant varieties; net nurseries; remove weed hosts."],
    callOfficer: "Call if more than 1 in 10 plants shows mosaic.",
    urgency: "medium",
    source: "BJRI; WorldVeg",
  },
  {
    id: "drought_stress",
    name: "Water stress (drought)",
    type: "abiotic",
    crops: "*",
    signs: { leaf_rolling_drought: 1, white_burnt_tips: 0.2, old_leaves_yellow: 0.1 },
    context: { dry: 0.5, hot: 0.2 },
    summary: "Roots cannot get enough water: leaves roll or droop in the afternoon.",
    treatment: ["Irrigate now — see the Irrigation planner for how many mm.", "Irrigate in the evening or early morning; mulch vegetables."],
    prevention: ["Use the Irrigation planner; for rice use AWD safely (re-flood at 15 cm)."],
    callOfficer: "Not usually needed.",
    urgency: "medium",
    source: "FAO-56; IRRI AWD",
  },
];

export interface DoctorContext {
  humid: boolean; // RH ≥ 85% or recent rain
  flood: boolean; // recent flood risk / waterlogging
  salinity: boolean; // EC above crop threshold or salinity risk
  dry: boolean; // deficit / no rain
  hot: boolean; // Tmax ≥ 34 °C
}

export interface DiagnosisResult {
  cause: Cause;
  score: number; // 0-100 relative likelihood
  matched: string[];
  contextHits: (keyof DoctorContext)[];
}

const applies = (crops: string[] | "*", crop: string) => crops === "*" || crops.includes(crop);

export function symptomsFor(crop: string, part: Part | null): Symptom[] {
  return SYMPTOMS.filter((s) => applies(s.crops, crop) && (!part || s.parts.includes(part)));
}

/** Rank likely causes: symptom evidence (weighted, penalising unexplained symptoms) + farm context. */
export function diagnose(crop: string, symptoms: string[], ctx?: Partial<DoctorContext>): DiagnosisResult[] {
  if (!symptoms.length) return [];
  const res: DiagnosisResult[] = [];
  for (const c of CAUSES) {
    if (!applies(c.crops, crop)) continue;
    const matched = symptoms.filter((s) => (c.signs[s] ?? 0) > 0);
    if (!matched.length) continue;
    const evidence = matched.reduce((s, id) => s + c.signs[id]!, 0) / symptoms.length;
    const contextHits = (Object.keys(c.context ?? {}) as (keyof DoctorContext)[]).filter((k) => ctx?.[k]);
    const boost = contextHits.reduce((s, k) => s + (c.context![k] ?? 0), 0);
    res.push({ cause: c, score: evidence * (1 + boost), matched, contextHits });
  }
  const max = Math.max(...res.map((r) => r.score), 1e-6);
  const total = res.reduce((s, r) => s + r.score, 0) || 1;
  return res
    .map((r) => ({ ...r, score: Math.round(Math.min(95, (r.score / total) * 100 * 0.6 + (r.score / max) * 40)) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

export const causeById = (id: string) => CAUSES.find((c) => c.id === id);
