import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function routeFileForHref(href: string): string {
  const routePath = href.replace(/^\//, "");
  return path.join(root, "src", "app", routePath, "page.tsx");
}

describe("local install regressions", () => {
  it("uses Docker image tags and Temporal driver that start together", () => {
    const compose = read("docker-compose.yml");

    expect(compose).toContain("image: apache/age:release_PG16_1.5.0");
    expect(compose).toContain("image: temporalio/auto-setup:1.29");
    expect(compose).toContain("image: temporalio/admin-tools:1.29");
    expect(compose).toContain("- DB=postgres12");
    expect(compose).not.toContain("- DB=postgresql");
    expect(compose).not.toContain("apache/age:PG16-v1.5.0");
    expect(compose).not.toContain("temporalio/auto-setup:1.26.1");
    expect(compose).not.toContain("temporalio/admin-tools:1.26.1");
  });

  it("keeps migrations committed and setup scripts from creating ad hoc init migrations", () => {
    const gitignore = read(".gitignore");
    const packageJson = JSON.parse(read("package.json")) as {
      scripts: Record<string, string>;
    };

    expect(gitignore).not.toContain("prisma/migrations/");
    expect(
      fs.existsSync(
        path.join(root, "prisma", "migrations", "20260707033204_init", "migration.sql"),
      ),
    ).toBe(true);
    expect(packageJson.scripts["db:migrate"]).toBe("prisma migrate dev");
  });

  it("exposes NextAuth session support and does not import the missing client API", () => {
    expect(
      fs.existsSync(path.join(root, "src", "app", "api", "auth", "[...nextauth]", "route.ts")),
    ).toBe(true);

    const apiClient = read("src/lib/api-client.ts");
    expect(apiClient).not.toContain("next-auth/react");
    expect(apiClient).not.toContain('"authenticated"');
  });

  it("redirects successful login to an implemented dashboard route", () => {
    const loginPage = read("src/app/(auth)/login/page.tsx");

    expect(loginPage).toContain('router.push("/dashboard")');
    expect(fs.existsSync(routeFileForHref("/dashboard"))).toBe(true);
  });

  it("main navigation links point to implemented routes", () => {
    const sidebar = read("src/components/dashboard/sidebar.tsx");
    const hrefs = [...sidebar.matchAll(/href: "([^"]+)"/g)]
      .map((match) => match[1])
      .filter((href): href is string => Boolean(href));

    expect(hrefs.length).toBeGreaterThan(0);

    for (const href of hrefs) {
      expect(fs.existsSync(routeFileForHref(href))).toBe(true);
    }
  });
});
