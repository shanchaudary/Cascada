import { afterEach, describe, expect, it, vi } from "vitest";
import { buildUrl, resolveBaseUrl } from "@/lib/api-client";

describe("api client URL resolution", () => {
  const originalNextAuthUrl = process.env["NEXTAUTH_URL"];
  const originalPublicUrl = process.env["NEXT_PUBLIC_APP_URL"];

  afterEach(() => {
    if (originalNextAuthUrl === undefined) {
      delete process.env["NEXTAUTH_URL"];
    } else {
      process.env["NEXTAUTH_URL"] = originalNextAuthUrl;
    }

    if (originalPublicUrl === undefined) {
      delete process.env["NEXT_PUBLIC_APP_URL"];
    } else {
      process.env["NEXT_PUBLIC_APP_URL"] = originalPublicUrl;
    }

    vi.unstubAllGlobals();
  });

  it("falls back to window.location.origin in the browser", () => {
    delete process.env["NEXT_PUBLIC_APP_URL"];
    vi.stubGlobal("window", {
      location: { origin: "http://browser.test" },
    });

    expect(resolveBaseUrl()).toBe("http://browser.test");
    expect(buildUrl("/api/x")).toBe("http://browser.test/api/x");
  });

  it("uses NEXT_PUBLIC_APP_URL in the browser when present", () => {
    process.env["NEXT_PUBLIC_APP_URL"] = "http://public.test";
    vi.stubGlobal("window", {
      location: { origin: "http://browser.test" },
    });

    expect(buildUrl("/api/x", { page: 2, active: true })).toBe(
      "http://public.test/api/x?page=2&active=true",
    );
  });

  it("uses NEXTAUTH_URL on the server", () => {
    vi.stubGlobal("window", undefined);
    process.env["NEXTAUTH_URL"] = "http://server.test";

    expect(resolveBaseUrl()).toBe("http://server.test");
    expect(buildUrl("/api/x")).toBe("http://server.test/api/x");
  });

  it("falls back to localhost on the server", () => {
    vi.stubGlobal("window", undefined);
    delete process.env["NEXTAUTH_URL"];

    expect(resolveBaseUrl()).toBe("http://localhost:3000");
  });
});
