import { describe, expect, it } from "vitest";
import { depthWeighted, parseFeatureInfoValue } from "../server/live/soil";

const html = (v: string) => `<!DOCTYPE html>
<html><body>
    <b>Latitude: </b><span id="latitude">90.349351</span><br>
    <b>Value: </b><span id="value">${v}</span><br>
    <b>Query Layer: </b><span id="value">clay_0-5cm_mean</span><br>
    <b>Unit: </b>g/kg<br>
</body></html>`;

describe("SoilGrids WMS fallback", () => {
  it("reads the mapped value from MapServer's GetFeatureInfo HTML", () => {
    expect(parseFeatureInfoValue(html("266"))).toBe(266);
    expect(parseFeatureInfoValue(html("-3.5"))).toBe(-3.5);
  });

  it("returns null where SoilGrids has no data (water, urban, ice)", () => {
    expect(parseFeatureInfoValue(html(""))).toBeNull();
    expect(parseFeatureInfoValue("GetFeatureInfo results:\n\nLayer 'clay_0-5cm_mean'\n  Feature 0:")).toBeNull();
  });

  it("depth-weights 0-30 cm and converts mapped units (÷10)", () => {
    // clay 266/280/300 g/kg → (26.6·5 + 28·10 + 30·15)/30 = 28.8 %
    expect(depthWeighted({ "0-5cm": 266, "5-15cm": 280, "15-30cm": 300 })).toBe(28.8);
    // missing layers are skipped, not treated as zero
    expect(depthWeighted({ "0-5cm": 56, "5-15cm": null, "15-30cm": undefined })).toBe(5.6);
    expect(depthWeighted({})).toBeNull();
  });
});
