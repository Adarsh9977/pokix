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

  it("points at an output directory that is really there", () => {
    // The exact failure this guards against: Vercel ran the build, the build
    // emitted nothing, and the deploy died looking for a directory that did
    // not exist. A unit test is a cheaper place to find that out.
    const output = join(repoRoot, vercel.outputDirectory);
    expect(existsSync(output)).toBe(true);
    expect(statSync(output).isDirectory()).toBe(true);
  });

  it("serves an index page from the output directory", () => {
    expect(
      existsSync(join(repoRoot, vercel.outputDirectory, "index.html")),
    ).toBe(true);
  });

  it("keeps the placeholder honest about there being no game yet", () => {
    const page = read("public/index.html").toLowerCase();
    expect(page).toContain("placeholder");
    expect(page).not.toContain("play now");
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
