import React from "react";
import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { pathToFileURL } from "node:url";

export const DIAGNOSTIC_REPORT_SECTIONS = [
  "Executive Summary",
  "Regulatory Trigger Inventory",
  "Jurisdiction Exposure",
  "Product Portfolio Exposure",
  "Ingredient Risk Analysis",
  "Customer and Revenue Impact",
  "Compliance Timeline",
  "Recommended Decisions",
  "Appendix and Assumptions",
] as const;

const styles = StyleSheet.create({
  page: {
    padding: 48,
    fontSize: 11,
    fontFamily: "Helvetica",
    lineHeight: 1.5,
  },
  eyebrow: {
    color: "#475569",
    fontSize: 9,
    marginBottom: 16,
    textTransform: "uppercase",
  },
  title: {
    color: "#0f172a",
    fontSize: 22,
    marginBottom: 18,
  },
  body: {
    color: "#334155",
    marginBottom: 12,
  },
  footer: {
    borderTop: "1 solid #cbd5e1",
    color: "#64748b",
    fontSize: 9,
    marginTop: "auto",
    paddingTop: 12,
  },
});

export function buildDiagnosticSmokeDocument() {
  return React.createElement(
    Document,
    null,
    ...DIAGNOSTIC_REPORT_SECTIONS.map((section, index) =>
      React.createElement(
        Page,
        { key: section, size: "A4", style: styles.page },
        React.createElement(Text, { style: styles.eyebrow }, "Cascada diagnostic report smoke"),
        React.createElement(Text, { style: styles.title }, `${index + 1}. ${section}`),
        React.createElement(
          Text,
          { style: styles.body },
          "This smoke document verifies that the PDF renderer can produce the full diagnostic report shape expected by the product: one stable page for each major report section.",
        ),
        React.createElement(
          View,
          null,
          React.createElement(
            Text,
            { style: styles.body },
            "The check intentionally validates page count and section coverage, not just that a non-empty byte buffer was returned.",
          ),
        ),
        React.createElement(
          Text,
          { style: styles.footer },
          `Section ${index + 1} of ${DIAGNOSTIC_REPORT_SECTIONS.length}`,
        ),
      ),
    ),
  );
}

export function countPdfPages(buffer: Buffer): number {
  const pdfText = buffer.toString("latin1");
  return (pdfText.match(/\/Type\s*\/Page\b/g) ?? []).length;
}

export async function renderDiagnosticSmokePdf(): Promise<Buffer> {
  return renderToBuffer(buildDiagnosticSmokeDocument());
}

async function main() {
  const buffer = await renderDiagnosticSmokePdf();
  const pageCount = countPdfPages(buffer);

  if (!buffer.toString("latin1").startsWith("%PDF-")) {
    throw new Error("PDF renderer did not return a valid PDF header");
  }

  if (!buffer.toString("latin1").includes("%%EOF")) {
    throw new Error("PDF renderer did not return a complete PDF trailer");
  }

  if (pageCount !== DIAGNOSTIC_REPORT_SECTIONS.length) {
    throw new Error(
      `Expected ${DIAGNOSTIC_REPORT_SECTIONS.length} PDF pages, received ${pageCount}`,
    );
  }

  if (buffer.length < 6_000) {
    throw new Error(`PDF buffer was unexpectedly small (${buffer.length} bytes)`);
  }

  console.log(`PDF smoke test passed (${buffer.length} bytes, ${pageCount} pages)`);
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";

if (import.meta.url === invokedPath) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
