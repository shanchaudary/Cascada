import React from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ColumnDef } from "@/components/dashboard/data-table";
import type { ExposureByState } from "@/types/api";

(globalThis as { React?: typeof React }).React = React;

interface TestRow {
  id: string;
  name: string;
}

const columns: ColumnDef<TestRow>[] = [
  {
    key: "name",
    header: "Name",
    accessor: (row) => row.name,
  },
];

describe("dashboard defensive components", () => {
  it("DataTable renders an empty state instead of crashing on malformed data props", async () => {
    const { DataTable } = await import("@/components/dashboard/data-table");
    const Table = DataTable<TestRow>;
    const cases: unknown[] = [[], undefined, null, { data: [] }, { items: [] }];

    for (const data of cases) {
      expect(() =>
        renderToString(
          React.createElement(Table, {
            columns,
            data: data as TestRow[],
            rowKey: (row) => row.id,
            emptyMessage: "No rows",
          }),
        ),
      ).not.toThrow();
    }
  });

  it("ExposureMap renders an empty state instead of crashing on malformed data props", async () => {
    const { ExposureMap } = await import("@/components/dashboard/exposure-map");
    const cases: unknown[] = [[], undefined, null, { data: [] }, { items: [] }];

    for (const data of cases) {
      expect(() =>
        renderToString(
          React.createElement(ExposureMap, {
            data: data as ExposureByState[],
          }),
        ),
      ).not.toThrow();
    }
  });
});
