import { describe, expect, it } from "vitest";
import { renderDiagnosticSmokePdf, countPdfPages, DIAGNOSTIC_REPORT_SECTIONS } from "../../scripts/smoke-pdf";

describe("diagnostic PDF smoke", () => {
  it("defines the expected nine diagnostic report sections", () => {
    expect(DIAGNOSTIC_REPORT_SECTIONS).toEqual([
      "Executive Summary",
      "Regulatory Trigger Inventory",
      "Jurisdiction Exposure",
      "Product Portfolio Exposure",
      "Ingredient Risk Analysis",
      "Customer and Revenue Impact",
      "Compliance Timeline",
      "Recommended Decisions",
      "Appendix and Assumptions",
    ]);
  });

  it("renders a complete nine-page diagnostic-style PDF", async () => {
    const buffer = await renderDiagnosticSmokePdf();
    const pdfText = buffer.toString("latin1");

    expect(pdfText.startsWith("%PDF-")).toBe(true);
    expect(pdfText).toContain("%%EOF");
    expect(countPdfPages(buffer)).toBe(DIAGNOSTIC_REPORT_SECTIONS.length);
    expect(buffer.length).toBeGreaterThan(6_000);
  });
});
