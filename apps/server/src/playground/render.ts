/**
 * Renders a PlaygroundReport as the terminal output the spec sketches.
 *
 * Pure string building, so the exact wording can be asserted in tests -
 * including the assertion that no credential ever appears in it.
 */

import type { PlaygroundCheck, PlaygroundReport } from "./playground";

const RULE = "━".repeat(46);
const MARK: Record<PlaygroundCheck["status"], string> = {
  pass: "✓",
  fail: "✗",
  skipped: "–",
};

function bar(value: number, width = 20): string {
  const filled = Math.max(0, Math.min(width, Math.round(value * width)));
  return "█".repeat(filled) + "░".repeat(width - filled);
}

export function renderPlaygroundReport(report: PlaygroundReport): string {
  const lines: string[] = [];

  lines.push(RULE);
  lines.push("            JEV PLAYGROUND");
  lines.push(RULE);
  lines.push("");

  for (const check of report.checks) {
    lines.push(
      `  ${MARK[check.status]}  ${check.name.padEnd(22)}${check.detail ?? ""}`,
    );
  }
  lines.push("");

  if (report.decision) {
    const { decision } = report;
    lines.push("  Decision");
    lines.push(`      ${decision.action}`);
    lines.push("");
    lines.push("  Probability");
    lines.push(`      ${decision.probability.toFixed(3)}`);
    lines.push("");
    lines.push("  Confidence");
    lines.push(`      ${decision.confidence.toFixed(3)}`);
    lines.push("");
    lines.push("  Distribution");
    for (const [option, probability] of Object.entries(
      decision.probabilities,
    ).sort((a, b) => b[1] - a[1])) {
      lines.push(
        `      ${option.padEnd(8)} ${bar(probability)} ${probability.toFixed(3)}`,
      );
    }
    lines.push("");
  }

  if (report.latencyMs !== undefined) {
    lines.push("  Latency");
    lines.push(`      ${report.latencyMs} ms`);
    lines.push("");
  }

  if (report.model) {
    lines.push("  Model");
    lines.push(`      ${report.model}`);
    lines.push("");
  }

  if (report.usage) {
    lines.push("  Usage");
    lines.push(
      `      ${report.usage.inputTokens} input tokens, ${report.usage.outputTokens} output tokens`,
    );
    lines.push("");
  }

  if (report.concurrency) {
    lines.push("  Concurrent decisions");
    lines.push(
      report.concurrency.bothSucceeded
        ? `      two at once in ${report.concurrency.latencyMs} ms, answers ${report.concurrency.agreed ? "agreed" : "differed"}`
        : "      failed",
    );
    lines.push("");
  }

  lines.push("  Credits");
  lines.push(`      ${report.credits.status}`);
  lines.push(...wrap(report.credits.detail, 6, 66));
  lines.push("");

  if (report.failure) {
    lines.push("  Category");
    lines.push(`      ${report.failure.category}`);
    lines.push("");
    lines.push("  Provider response");
    lines.push(
      ...wrap(report.failure.providerMessage ?? report.failure.message, 6, 66),
    );
    if (report.failure.providerRequestId) {
      lines.push("");
      lines.push("  Provider request id");
      lines.push(`      ${report.failure.providerRequestId}`);
    }
    lines.push("");
    lines.push(
      report.failure.retryable
        ? "  This category is documented as retryable. Back off and try again."
        : "  This category is not retryable. Retrying will fail the same way.",
    );
    lines.push("");
    lines.push("  The game remains fully playable with AGENT_MODE=mock.");
    lines.push("");
  }

  lines.push(RULE);
  return lines.join("\n");
}

function wrap(text: string, indent: number, width: number): string[] {
  const pad = " ".repeat(indent);
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";

  for (const word of words) {
    if (line === "") {
      line = word;
    } else if (line.length + 1 + word.length <= width) {
      line += ` ${word}`;
    } else {
      lines.push(pad + line);
      line = word;
    }
  }
  if (line !== "") lines.push(pad + line);
  return lines;
}
