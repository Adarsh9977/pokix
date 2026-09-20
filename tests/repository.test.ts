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

  it("never asks Node to import raw TypeScript at runtime", () => {
    // The bug this exists to prevent: workspace packages pointed `exports`
    // at `./src/index.ts`. Vite and Vitest resolve that happily, but Node
    // cannot load `.ts` and Vercel traces dependencies rather than bundling
    // them, so every serverless invocation died with
    // ERR_UNKNOWN_FILE_EXTENSION before reaching any of our code.
    //
    // Any package a Vercel function imports must resolve to real JavaScript
    // for the runtime, whatever it resolves to for the typechecker.
    const server = JSON.parse(read("apps/server/package.json")) as {
      exports: { ".": { types: string; default: string } };
      scripts?: Record<string, string>;
    };

    expect(server.exports["."].default).toMatch(/\.js$/);
    expect(server.exports["."].default).not.toMatch(/\.tsx?$/);
    expect(server.scripts?.build).toBeDefined();
  });

  it("builds the server bundle before the web app, so the functions have it", () => {
    const build = rootPackageJson.scripts.build ?? "";
    expect(build).toContain("@jev-arena/server");
    expect(build.indexOf("@jev-arena/server")).toBeLessThan(
      build.indexOf("@jev-arena/web"),
    );
  });

  it("gives the serverless functions exactly one workspace import", () => {
    // Each additional bare workspace import is another package that has to
    // ship runnable JavaScript. Funnelling them through @jev-arena/server
    // keeps that surface at one.
    for (const file of ["api/decide.ts", "api/config.ts"]) {
      const source = read(file);
      const imports = [...source.matchAll(/from "(@jev-arena\/[^"]+)"/g)].map(
        (match) => match[1],
      );
      expect(new Set(imports), file).toEqual(new Set(["@jev-arena/server"]));
    }
  });

  it("keeps the decision endpoint where Vercel looks for functions", () => {
    const api = join(repoRoot, "api/decide.ts");
    expect(existsSync(api)).toBe(true);
    expect(statSync(api).isFile()).toBe(true);
  });

  it("never ships the API key to the browser", () => {
    // Anything under apps/web/src is bundled and served publicly.
    //
    // This checks that no key is ever *read*, rather than that the string
    // "TYPESAFE_API_KEY" never appears. Naming the variable in help text is
    // fine and useful - "this deployment has no TYPESAFE_API_KEY" is exactly
    // what a user needs to be told. Reading its value is what must not
    // happen, so that is what is asserted.
    const files = [
      "apps/web/src/App.tsx",
      "apps/web/src/main.tsx",
      "apps/web/src/game/use-match.ts",
      "apps/web/src/game/remote-jev-agent.ts",
    ];

    for (const file of files) {
      const source = read(file);
      // No environment access of any kind: Vite inlines these at build time,
      // so anything read here is baked into a public asset.
      expect(source, file).not.toMatch(/import\.meta\.env/);
      expect(source, file).not.toMatch(/process\.env/);
      // No provider client, and no credential-shaped identifier.
      expect(source, file).not.toContain("@typesafe-ai/sdk");
      expect(source, file).not.toMatch(/\bapiKey\b/);
      expect(source, file).not.toMatch(/Bearer\s/);
      // No direct calls to the provider: the browser talks to /api only.
      expect(source, file).not.toContain("api.typesafe.ai");
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
