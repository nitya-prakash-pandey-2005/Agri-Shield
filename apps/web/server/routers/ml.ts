/**
 * ML procedures (spec §10 mlRouter) — thin wrappers over server/ml-client.ts.
 */
import { z } from "zod";
import { protectedProcedure, publicProcedure, router } from "../trpc";
import { askAdvisor, getFloodRisk, getModelMetrics, getSalinityRisk, mlHealth } from "../ml-client";

const CROPS = ["rice", "wheat", "maize", "sugarcane", "jute", "coconut", "vegetables", "sorghum", "barley", "potato", "onion", "cotton", "tobacco", "banana", "mango"] as const;
const point = { lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) };

export const mlRouter = router({
  getFloodRisk: publicProcedure
    .input(z.object({ ...point, exposure: z.number().min(0).max(1).optional() }))
    .mutation(({ input }) => getFloodRisk(input.lat, input.lon, input.exposure)),

  getSalinityRisk: publicProcedure
    .input(z.object({ ...point, cropType: z.enum(CROPS).default("rice"), exposure: z.number().min(0).max(1).optional() }))
    .mutation(({ input }) => getSalinityRisk(input.lat, input.lon, input.cropType, input.exposure)),

  askAdvisor: protectedProcedure
    .input(
      z.object({
        question: z.string().min(2).max(1000),
        language: z.string().max(5).default("en"),
        history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(4000) })).max(20).default([]),
        context: z.object({
          name: z.string(),
          crops: z.array(z.string()),
          area_ha: z.number(),
          district: z.string(),
          country: z.string(),
          flood_probability: z.number(),
          salinity_ec: z.number(),
          forecast_summary: z.string(),
          soil_type: z.string().optional(),
        }),
      })
    )
    .mutation(({ input }) => askAdvisor(input.question, input.context, input.language, input.history)),

  getModelMetrics: publicProcedure.query(() => getModelMetrics()),
  health: publicProcedure.query(() => mlHealth()),
});
