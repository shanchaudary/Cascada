// @ts-nocheck -- @playwright/test is installed only in the CI browser-smoke step.
import { expect, test } from "@playwright/test";

const runtimeErrorPattern =
  /allTriggers is not iterable|data is not iterable|Application error|Unhandled Runtime Error/i;

test("protected tenant API rejects an unauthenticated request", async ({ request }) => {
  const response = await request.get("/api/tenants/current");
  expect(response.status()).toBe(401);
});

test("seeded tenant can sign in and hydrate the dashboard", async ({ page }) => {
  await page.goto("/login");

  await expect(page.getByRole("heading", { name: "Sign in to Cascada" })).toBeVisible();
  await page.getByLabel("Email address").fill("admin@demofoods.com");
  await page.getByLabel("Password").fill("cascada-demo-2026");
  await page.getByLabel("Organization slug").fill("demo-foods");

  await Promise.all([
    page.waitForURL(/\/dashboard(?:\?.*)?$/),
    page.getByRole("button", { name: "Sign in" }).click(),
  ]);

  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(page.locator("body")).not.toContainText(runtimeErrorPattern);

  const tenantResponse = await page.request.get("/api/tenants/current");
  expect(tenantResponse.status()).toBe(200);
  const payload = await tenantResponse.json();
  expect(payload).toBeTruthy();
});
