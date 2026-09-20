/**
 * A very small `.env` reader.
 *
 * Deliberately not a dependency. It handles the handful of forms a `.env`
 * actually uses, does not override anything already set in the real
 * environment, and never logs a value.
 */

import { existsSync, readFileSync } from "node:fs";

export function parseDotEnv(contents: string): Record<string, string> {
  const result: Record<string, string> = {};

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;

    const withoutExport = line.startsWith("export ")
      ? line.slice(7).trim()
      : line;
    const separator = withoutExport.indexOf("=");
    if (separator <= 0) continue;

    const key = withoutExport.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

    let value = withoutExport.slice(separator + 1).trim();
    const quoted =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"));

    if (quoted && value.length >= 2) {
      value = value.slice(1, -1);
    } else {
      // Only strip comments from unquoted values, so a '#' inside a quoted
      // secret survives.
      const comment = value.indexOf(" #");
      if (comment >= 0) value = value.slice(0, comment).trim();
    }

    result[key] = value;
  }

  return result;
}

/**
 * Loads `.env` into `target` without overwriting anything already present.
 * A real environment variable always wins over the file.
 */
export function loadDotEnv(
  path = ".env",
  target: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!existsSync(path)) return false;

  for (const [key, value] of Object.entries(
    parseDotEnv(readFileSync(path, "utf8")),
  )) {
    if (target[key] === undefined || target[key] === "") {
      target[key] = value;
    }
  }
  return true;
}
