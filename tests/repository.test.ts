import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function read(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), "utf8");
}

const rootPackageJson = JSON.parse(read("package.json")) as {
  workspaces: string[];
  scripts: Record<string, string>;
  engines: Record<string, string>;
};

describe("workspace configuration", () => {
  it("declares the packages and apps workspaces", () => {
    expect(rootPackageJson.workspaces).toEqual(["packages/*", "apps/*"]);
  });

  it("exposes the scripts the README and spec rely on", () => {
    for (const script of ["typecheck", "build", "test", "lint", "format"]) {
      expect(rootPackageJson.scripts).toHaveProperty(script);
    }
  });

  it("pins a Node version that the TypeSafe JavaScript SDK supports", () => {
    // The TypeSafe JS SDK documents Node.js 20 or newer.
    expect(rootPackageJson.engines.node).toBe(">=20.19.0");
  });
});

describe("deployment configuration", () => {
  const vercel = JSON.parse(read("vercel.json")) as {
    buildCommand: string;
    outputDirectory: string;
  };

  it("builds with a script that actually exists", () => {
    const script = vercel.buildCommand.replace(/^npm run /, "");
    expect(rootPackageJson.scripts).toHaveProperty(script);
  });

  it("points its output directory at the web app's build output", () => {
    // The failure this guards against: the build emits one place and Vercel
    // looks in another, which only shows up as a failed deploy.
    expect(vercel.outputDirectory).toBe("apps/web/dist");
    const webPackage = JSON.parse(read("apps/web/package.json")) as {
      scripts: Record<string, string>;
    };
    expect(webPackage.scripts.build).toBe("vite build");
  });

  it("has a web app with an entry point for Vite to build", () => {
    for (const file of [
      "apps/web/index.html",
      "apps/web/src/main.tsx",
      "apps/web/vite.config.ts",
    ]) {
      expect(existsSync(join(repoRoot, file)), file).toBe(true);
    }
  });

  it("keeps the decision endpoint where Vercel looks for functions", () => {
    const api = join(repoRoot, "api/decide.ts");
    expect(existsSync(api)).toBe(true);
    expect(statSync(api).isFile()).toBe(true);
  });

  it("never ships the API key to the browser", () => {
    // Anything under apps/web/src is bundled and served publicly. The key
    // must not be referenced there at all, not even via import.meta.env.
    const files = [
      "apps/web/src/App.tsx",
      "apps/web/src/main.tsx",
      "apps/web/src/game/use-match.ts",
      "apps/web/src/game/remote-jev-agent.ts",
    ];
    for (const file of files) {
      const source = read(file);
      expect(source, file).not.toContain("TYPESAFE_API_KEY");
      expect(source, file).not.toContain("apiKey");
      expect(source, file).not.toContain("@typesafe-ai/sdk");
    }
  });

  it("keeps the TypeSafe SDK out of the web app's dependencies", () => {
    const webPackage = JSON.parse(read("apps/web/package.json")) as {
      dependencies: Record<string, string>;
    };
    expect(Object.keys(webPackage.dependencies)).not.toContain(
      "@typesafe-ai/sdk",
    );
    expect(Object.keys(webPackage.dependencies)).not.toContain(
      "@jev-arena/server",
    );
  });
});

describe("credential hygiene", () => {
  const gitignore = read(".gitignore");
  const envExample = read(".env.example");

  it("git-ignores .env but keeps .env.example tracked", () => {
    expect(gitignore).toMatch(/^\.env$/m);
    expect(gitignore).toMatch(/^!\.env\.example$/m);
  });

  it("documents the TypeSafe API key without providing a value", () => {
    expect(envExample).toMatch(/^TYPESAFE_API_KEY=$/m);
  });

  it("defaults the agent mode to mock so tests never spend credits", () => {
    expect(envExample).toMatch(/^AGENT_MODE=mock$/m);
    expect(envExample).toMatch(/^RUN_LIVE_JEV_TESTS=false$/m);
  });

  it("contains no value that looks like a real secret", () => {
    for (const line of envExample.split("\n")) {
      if (line.startsWith("#") || !line.includes("=")) continue;
      const value = line.slice(line.indexOf("=") + 1).trim();
      expect(value.length).toBeLessThan(24);
    }
  });
});
