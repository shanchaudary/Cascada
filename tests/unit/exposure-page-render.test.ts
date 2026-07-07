import React from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

(globalThis as { React?: typeof React }).React = React;

const hookState = vi.hoisted(() => ({
  stateData: {
    exposures: [
      {
        jurisdiction: "California",
        activeRuleCount: 1,
        activeTriggerCount: 1,
        skusAffected: 3,
        financialExposure: 1000,
        triggerBreakdown: [{ severity: "HIGH", count: 1 }],
      },
    ],
  } as unknown,
  productData: {
    products: [],
    totalProducts: 0,
  } as unknown,
}));

vi.mock("@/hooks", () => ({
  useExposureByState: () => ({
    data: hookState.stateData,
    isLoading: false,
    error: null,
  }),
  useExposureByProduct: () => ({
    data: hookState.productData,
    isLoading: false,
    error: null,
  }),
}));

describe("ExposurePage render", () => {
  it("renders without crashing when exposure hooks receive API envelopes", async () => {
    const { default: ExposurePage } = await import("@/app/dashboard/exposure/page");

    expect(() => renderToString(React.createElement(ExposurePage))).not.toThrow();
    expect(renderToString(React.createElement(ExposurePage))).toContain("Exposure Analysis");
  });
});
