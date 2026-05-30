/**
 * GSD Context Overlay — TUI chart for /gsd context
 */

import type { Theme, ThemeColor } from "@gsd/pi-coding-agent";
import { matchesKey, Key, truncateToWidth } from "@gsd/pi-tui";

import type { ContextBreakdownReport, ContextSectionBreakdown } from "./commands-context.js";
import { formatTokenCount } from "./metrics.js";
import { renderDialogFrame, renderKeyHints, renderProgressBar, rightAlign } from "./tui/render-kit.js";

const SECTION_COLORS: ThemeColor[] = ["accent", "success", "warning", "borderAccent", "text"];

export function getContextChartTotals(report: ContextBreakdownReport): {
  systemTokens: number;
  conversationTokens: number;
  estimated: number;
  window: number | null;
  inContext: number;
  remaining: number;
} {
  const systemTokens = report.systemSections.reduce((sum, section) => sum + section.tokens, 0);
  const conversationTokens = report.conversationSections.reduce((sum, section) => sum + section.tokens, 0);
  const estimated = systemTokens + conversationTokens;
  const window = report.contextUsage?.contextWindow ?? null;
  const inContext = report.contextUsage?.tokens ?? estimated;
  const remaining = window != null ? Math.max(0, window - inContext) : 0;
  return { systemTokens, conversationTokens, estimated, window, inContext, remaining };
}

function formatPct(value: number, total: number): string {
  if (total <= 0) return "0%";
  return `${((value / total) * 100).toFixed(total >= 10_000 ? 0 : 1)}%`;
}

function renderSectionBars(
  theme: Theme,
  sections: ContextSectionBreakdown[],
  total: number,
  width: number,
  labelWidth: number,
): string[] {
  if (sections.length === 0) return [theme.fg("dim", "    (none)")];

  const maxTokens = Math.max(...sections.map((section) => section.tokens), 1);
  const barWidth = Math.max(12, width - labelWidth - 22);
  const lines: string[] = [];

  for (const [index, section] of sections.entries()) {
    const color = SECTION_COLORS[index % SECTION_COLORS.length]!;
    const label = truncateToWidth(section.label, labelWidth, "…").padEnd(labelWidth);
    const bar = renderProgressBar(theme, section.tokens, maxTokens, barWidth, {
      filledColor: color,
      filledChar: "█",
      emptyChar: "░",
    });
    const meta = `${formatTokenCount(section.tokens)} ${formatPct(section.tokens, total)}`;
    lines.push(`    ${theme.fg("muted", label)} ${bar} ${theme.fg(color, meta)}`);
    if (section.detail) {
      lines.push(theme.fg("dim", `      ${section.detail}`));
    }
  }

  return lines;
}

export class GSDContextOverlay {
  private tui: { requestRender: () => void };
  private theme: Theme;
  private onClose: () => void;
  private report: ContextBreakdownReport;
  private cachedLines?: string[];
  private cachedWidth?: number;
  private scrollOffset = 0;
  private disposed = false;

  constructor(
    tui: { requestRender: () => void },
    theme: Theme,
    report: ContextBreakdownReport,
    onClose: () => void,
  ) {
    this.tui = tui;
    this.theme = theme;
    this.report = report;
    this.onClose = onClose;
  }

  invalidate(): void {
    this.cachedLines = undefined;
    this.cachedWidth = undefined;
  }

  dispose(): void {
    this.disposed = true;
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape) || data === "q") {
      this.dispose();
      this.onClose();
      return;
    }
    if (matchesKey(data, Key.down) || data === "j") {
      this.scrollOffset++;
      this.cachedLines = undefined;
      this.tui.requestRender();
      return;
    }
    if (matchesKey(data, Key.up) || data === "k") {
      this.scrollOffset = Math.max(0, this.scrollOffset - 1);
      this.cachedLines = undefined;
      this.tui.requestRender();
      return;
    }
    if (matchesKey(data, Key.pageDown)) {
      this.scrollOffset += 12;
      this.cachedLines = undefined;
      this.tui.requestRender();
      return;
    }
    if (matchesKey(data, Key.pageUp)) {
      this.scrollOffset = Math.max(0, this.scrollOffset - 12);
      this.cachedLines = undefined;
      this.tui.requestRender();
    }
  }

  render(width: number): string[] {
    if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;

    const theme = this.theme;
    const w = Math.max(1, width);
    const contentWidth = Math.max(1, w - 4);
    const totals = getContextChartTotals(this.report);
    const chartTotal = Math.max(totals.inContext, totals.estimated, 1);
    const lines: string[] = [];

    if (this.report.modelLabel) {
      lines.push(rightAlign(theme.fg("muted", "Model"), theme.fg("text", this.report.modelLabel), contentWidth));
    }

    lines.push("");
    if (totals.window != null) {
      const usageBarWidth = Math.max(8, contentWidth - 28);
      const usageBar = renderProgressBar(theme, totals.inContext, totals.window, usageBarWidth, {
        filledColor: totals.inContext / totals.window > 0.85 ? "warning" : "accent",
      });
      lines.push(`  ${theme.fg("muted", "Window")} ${usageBar} ${theme.fg("text", `${formatTokenCount(totals.inContext)} / ${formatTokenCount(totals.window)}`)}`);
    } else {
      lines.push(`  ${theme.fg("muted", "Estimated")} ${theme.fg("text", formatTokenCount(chartTotal))}`);
    }

    const splitWidth = Math.max(8, Math.floor((contentWidth - 8) / 2));
    const systemBar = renderProgressBar(theme, totals.systemTokens, chartTotal, splitWidth, { filledColor: "accent" });
    const convBar = renderProgressBar(theme, totals.conversationTokens, chartTotal, splitWidth, { filledColor: "success" });
    lines.push("");
    lines.push(`  ${theme.fg("accent", "System")} ${systemBar} ${theme.fg("muted", formatPct(totals.systemTokens, chartTotal))}`);
    lines.push(`  ${theme.fg("success", "History")} ${convBar} ${theme.fg("muted", formatPct(totals.conversationTokens, chartTotal))}`);

    lines.push("");
    lines.push(theme.bold(theme.fg("accent", "  System prompt")));
    lines.push(...renderSectionBars(theme, this.report.systemSections, chartTotal, contentWidth, 22));

    lines.push("");
    lines.push(theme.bold(theme.fg("accent", "  Conversation")));
    lines.push(...renderSectionBars(theme, this.report.conversationSections, chartTotal, contentWidth, 22));

    lines.push("");
    lines.push(theme.bold(theme.fg("accent", "  Skills")));
    const { skills } = this.report;
    if (skills.available.length > 0) {
      lines.push(`    ${theme.fg("muted", "Available")} ${theme.fg("text", `${skills.available.length}`)}`);
      const preview = skills.available.slice(0, 8).join(", ");
      lines.push(truncateToWidth(`      ${preview}${skills.available.length > 8 ? "…" : ""}`, contentWidth));
    } else {
      lines.push(theme.fg("dim", "    none in prompt"));
    }
    if (skills.loaded.length > 0) {
      lines.push(`    ${theme.fg("muted", "Loaded")} ${theme.fg("success", skills.loaded.join(", "))}`);
    }
    if (skills.prefer.length > 0) {
      lines.push(`    ${theme.fg("muted", "Prefer")} ${theme.fg("accent", skills.prefer.join(", "))}`);
    }

    lines.push("");
    lines.push(theme.bold(theme.fg("accent", "  Agents")));
    lines.push(`    ${theme.fg("muted", "Subagent spawns")} ${theme.fg("text", String(this.report.subagentSpawns))}`);

    const terminalRows = process.stdout.rows || 32;
    const maxBodyRows = Math.max(1, Math.min(lines.length, terminalRows - 12));
    const maxScroll = Math.max(0, lines.length - maxBodyRows);
    this.scrollOffset = Math.min(this.scrollOffset, maxScroll);
    const visible = lines.slice(this.scrollOffset, this.scrollOffset + maxBodyRows);
    const footer = renderKeyHints(theme, ["esc/q close", "↑↓ scroll", "/gsd context --open"], contentWidth);

    this.cachedLines = renderDialogFrame(theme, "Context Breakdown", visible, w, {
      footer,
      scroll: { offset: this.scrollOffset, visibleRows: maxBodyRows, totalRows: lines.length },
    });
    this.cachedWidth = width;
    return this.cachedLines;
  }
}

export function formatContextChartText(report: ContextBreakdownReport, width = 72): string {
  const overlay = new GSDContextOverlay({ requestRender: () => {} }, {
    fg: (_c, t) => t,
    bold: (t) => t,
  } as Theme, report, () => {});
  return overlay.render(width).join("\n");
}
