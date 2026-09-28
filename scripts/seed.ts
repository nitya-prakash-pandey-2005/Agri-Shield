/**
 * Database Seed Script — Agri-SHIELD
 * Populates Postgres with realistic demo data for the hackathon.
 */
import { db } from '@agri-shield/db/src/client';
import { 
  users, farms, fields, cropCycles, alerts, 
  govResources, scCommodities 
} from '@agri-shield/db/src/schema';

async function main() {
  console.log("🌱 Seeding Agri-SHIELD Database...");

  try {
    // 1. Seed Demo Farmer
    const [demoFarmer] = await db.insert(users).values({
      name: "Rafiqul Islam",
      email: "rafiqul.demo@agrishield.io",
      phone: "+8801711000000",
      role: "FARMER",
      language: "bn",
    }).returning();

    const [farm] = await db.insert(farms).values({
      userId: demoFarmer.id,
      name: "Green Valley Farm",
      location: { lat: 22.7011, lon: 90.3637 }, // Barisal
      totalArea: 3.5,
    }).returning();

    // Fields
    const field1 = await db.insert(fields).values({
      farmId: farm.id,
      name: "North Paddy",
      area: 2.1,
      polygon: '{"type":"Polygon","coordinates":[[[90.355,22.710],[90.360,22.720],[90.375,22.718],[90.372,22.708],[90.360,22.705],[90.355,22.710]]]}',
      soilType: "clay_loam",
      elevationM: 4.2
    }).returning();

    // Active Crop Cycle
    await db.insert(cropCycles).values({
      fieldId: field1[0].id,
      cropType: "Rice",
      variety: "BRRI dhan 52",
      plantedAt: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000), // 45 days ago
      expectedHarvest: new Date(Date.now() + 75 * 24 * 60 * 60 * 1000),
      status: "active"
    });

    // 2. Seed Gov Resources
    await db.insert(govResources).values([
      { districtId: "barisal", type: "water_pump", totalCount: 45, deployedCount: 12 },
      { districtId: "khulna", type: "water_pump", totalCount: 80, deployedCount: 80 }, // Shortage
      { districtId: "sylhet", type: "sandbags", totalCount: 5000, deployedCount: 1200 },
    ]);

    // 3. Seed Supply Chain Commodities
    await db.insert(scCommodities).values([
      { name: "Rice", regionId: "bd_barisal", currentPrice: 485, volumeAtRisk: 1240, status: "critical" },
      { name: "Jute", regionId: "bd_dhaka", currentPrice: 1250, volumeAtRisk: 320, status: "watch" },
    ]);

    // 4. Seed Alerts
    await db.insert(alerts).values([
      {
        userId: demoFarmer.id,
        type: "flood",
        severity: "warning",
        title: "Flood Warning — Barisal",
        message: "Significant flooding likely in 24-72 hours. 72% probability. Move portable equipment.",
        status: "unread"
      }
    ]);

    console.log("✅ Database seeding completed successfully.");
    process.exit(0);

  } catch (error) {
    console.error("❌ Seeding failed:", error);
    process.exit(1);
  }
}

main();
