import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
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
    outputDirectory?: string;
    functions?: unknown;
  };

  it("builds with a script that actually exists", () => {
    const script = vercel.buildCommand.replace(/^npm run /, "");
    expect(rootPackageJson.scripts).toHaveProperty(script);
  });

  it("leaves output layout to the Build Output API, not to zero-config", () => {
    // outputDirectory and functions must be absent: setting either would
    // conflict with the .vercel/output the build writes.
    expect(vercel.outputDirectory).toBeUndefined();
    expect(vercel.functions).toBeUndefined();
    expect(vercel.buildCommand).toBe("npm run build");
  });

  it("writes the Build Output API as the last step of the build", () => {
    const build = rootPackageJson.scripts.build ?? "";
    expect(build).toContain("scripts/build-vercel.ts");
    expect(build.indexOf("@jev-arena/web")).toBeLessThan(
      build.indexOf("scripts/build-vercel.ts"),
    );
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

  it("has no top-level api/ directory for Vercel to auto-detect", () => {
    // The handlers live in apps/server/src/api and are bundled explicitly.
    // A stray top-level api/ would be picked up by zero-config detection
    // as well, giving two competing definitions of the same route.
    expect(existsSync(join(repoRoot, "api"))).toBe(false);
  });

  it("keeps the handlers with the rest of the server code", () => {
    for (const file of [
      "apps/server/src/api/decide.ts",
      "apps/server/src/api/config.ts",
    ]) {
      expect(existsSync(join(repoRoot, file)), file).toBe(true);
    }
  });

  it("builds a function for every handler, with none left behind", () => {
    // A handler that exists but is never listed in the build script would
    // simply 404 in production, with nothing to indicate why.
    const script = read("scripts/build-vercel.ts");
    const listed = script.match(/const FUNCTIONS = \[([^\]]+)\]/)?.[1] ?? "";
    for (const name of ["decide", "config"]) {
      expect(listed, `FUNCTIONS should include ${name}`).toContain(`"${name}"`);
    }
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

describe("working tree hygiene", () => {
  it("contains no sync-conflict duplicate files", () => {
    // This repo lives under ~/Documents, which iCloud syncs. When it races
    // with a write it leaves a copy named `App 2.tsx` beside `App.tsx`.
    // Those are picked up by tsconfig's include globs, so a stale duplicate
    // fails the typecheck with an error pointing at a file nobody edited.
    // Eight of them had already been committed before this test existed.
    const tracked = execFileSync("git", ["ls-files"], {
      cwd: repoRoot,
      encoding: "utf8",
    }).split("\n");

    const duplicates = tracked.filter((path) =>
      / \d+\.[A-Za-z0-9]+$/.test(path),
    );
    expect(
      duplicates,
      `sync-conflict copies are tracked: ${duplicates.join(", ")}`,
    ).toEqual([]);
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
