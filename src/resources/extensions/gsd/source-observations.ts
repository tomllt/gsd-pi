// Project/App: gsd-pi
// File Purpose: Active-unit source observations for provider payload context.

import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

import type { TaskRow } from "./db-task-slice-rows.js";
import { extractPlanningPathReference, normalizeFilePath } from "./pre-execution-checks.js";

export const WHOLE_FILE_OBSERVATION_MAX_BYTES = 50 * 1024;
export const WHOLE_FILE_OBSERVATION_MAX_LINES = 2000;

export type SourceObservationStatus =
  | "whole"
  | "missing"
  | "binary/image"
  | "over-threshold"
  | "glob"
  | "directory"
  | "unresolved selector";

export interface SourceObservationUnit {
  unitType: string;
  unitId: string;
  startedAt: number;
  basePath: string;
}

export type SourceObservationSource = "plan" | "read" | "mutation";

export interface SourceObservation {
  path: string;
  absolutePath: string | null;
  status: SourceObservationStatus;
  source: SourceObservationSource;
  text?: string;
  bytes?: number;
  lines?: number;
  reason?: string;
}

interface ActiveSourceObservationSet {
  unit: SourceObservationUnit;
  observations: Map<string, SourceObservation>;
}

const SOURCE_CONTEXT_TITLE = "## Source Context Block";
const SOURCE_OBSERVATION_UNIT_TYPE = "execute-task";

export function supportsSourceObservationsForUnit(unitType: string): boolean {
  return unitType === SOURCE_OBSERVATION_UNIT_TYPE;
}

export class SourceObservationStore {
  private active: ActiveSourceObservationSet | null = null;

  beginUnit(unit: SourceObservationUnit): void {
    if (!supportsSourceObservationsForUnit(unit.unitType)) {
      this.clear();
      return;
    }
    if (this.matches(unit)) return;
    this.active = { unit: { ...unit }, observations: new Map() };
  }

  clear(): void {
    this.active = null;
  }

  degradeUnit(unit: Pick<SourceObservationUnit, "unitType" | "unitId" | "startedAt">): void {
    if (!this.active) return;
    const current = this.active.unit;
    if (
      current.unitType === unit.unitType &&
      current.unitId === unit.unitId &&
      current.startedAt === unit.startedAt
    ) {
      this.active = null;
    }
  }

  observePlanTask(task: TaskRow): void {
    if (!this.active) return;
    for (const entry of planDeclaredSourceEntries(task)) {
      this.observePath(entry.path, "plan");
    }
  }

  observeRead(input: { path?: unknown; file_path?: unknown; [key: string]: unknown }): void {
    if (!this.active) return;
    const rawPath = readPathFromInput(input);
    if (!rawPath.trim()) return;
    this.observePath(rawPath, "read");
  }

  observeMutation(input: { path?: unknown; file_path?: unknown; [key: string]: unknown }): void {
    if (!this.active) return;
    const rawPath = readPathFromInput(input);
    if (!rawPath.trim()) return;
    this.observePath(rawPath, "mutation", { replaceExisting: true });
  }

  renderActiveBlock(): string | null {
    if (!this.active || this.active.observations.size === 0) return null;
    if (!supportsSourceObservationsForUnit(this.active.unit.unitType)) return null;
    const observations = [...this.active.observations.values()]
      .sort((a, b) => a.path.localeCompare(b.path));
    const lines = [
      SOURCE_CONTEXT_TITLE,
      `Active Unit: ${this.active.unit.unitType} ${this.active.unit.unitId}`,
      "",
      "The files below are protected active-Unit source context. " +
        "Use this block instead of rereading small files just to recover line windows.",
    ];

    const wholeFiles = observations.filter((observation) => observation.status === "whole");
    const unavailable = observations.filter((observation) => observation.status !== "whole");

    if (wholeFiles.length > 0) {
      lines.push("", "### Whole-File Observations");
      for (const observation of wholeFiles) {
        lines.push(
          "",
          `#### ${observation.path}`,
          `Status: whole-file (${observation.lines ?? 0} lines, ${formatSize(observation.bytes ?? 0)})`,
          fencedSource(observation.text ?? ""),
        );
      }
    }

    if (unavailable.length > 0) {
      lines.push("", "### Unavailable Source Observations");
      for (const observation of unavailable) {
        const detail = observation.reason ? ` - ${observation.reason}` : "";
        lines.push(`- ${observation.path}: ${observation.status}${detail}`);
      }
    }

    return lines.join("\n");
  }

  private matches(unit: SourceObservationUnit): boolean {
    if (!this.active) return false;
    const current = this.active.unit;
    return current.unitType === unit.unitType &&
      current.unitId === unit.unitId &&
      current.startedAt === unit.startedAt &&
      current.basePath === unit.basePath;
  }

  private observePath(
    rawPath: string,
    source: SourceObservationSource,
    options: { replaceExisting?: boolean } = {},
  ): void {
    if (!this.active) return;
    const observation = observeSourcePath(this.active.unit.basePath, rawPath, source);
    const key = observation.absolutePath ?? `${observation.status}:${observation.path}`;
    const existing = this.active.observations.get(key);
    if (options.replaceExisting || !existing || observation.status === "whole" || existing.status !== "whole") {
      this.active.observations.set(key, observation);
    }
  }
}

export function planDeclaredSourceEntries(
  task: TaskRow,
): Array<{ path: string; field: "files" | "inputs" }> {
  const entries: Array<{ path: string; field: "files" | "inputs" }> = [];
  for (const file of task.files) {
    const path = extractPlanningPathReference(file) ?? file.trim();
    if (path) entries.push({ path, field: "files" });
  }
  for (const input of task.inputs) {
    const path = extractPlanningPathReference(input);
    if (path) entries.push({ path, field: "inputs" });
  }
  return entries;
}

export function observeSourcePath(
  basePath: string,
  rawPath: string,
  source: SourceObservationSource,
): SourceObservation {
  const normalizedRaw = normalizeFilePath(rawPath.trim());
  const displayPath = normalizedRaw || rawPath.trim();
  if (!normalizedRaw) {
    return unavailable(displayPath || "<empty>", null, "unresolved selector", source);
  }
  if (containsGlobPattern(normalizedRaw)) {
    return unavailable(displayPath, null, "glob", source, "glob selectors are not whole files");
  }
  if (rawPath.trim().endsWith("/")) {
    return unavailable(displayPath, null, "directory", source, "directory selectors are not whole files");
  }

  const rootPath = resolve(basePath);
  const absolutePath = isAbsolute(normalizedRaw) ? resolve(normalizedRaw) : resolve(rootPath, normalizedRaw);
  const path = formatObservationPath(rootPath, absolutePath, displayPath);

  if (!isPathInsideRoot(rootPath, absolutePath)) {
    return unavailable(displayPath, absolutePath, "unresolved selector", source, "path is outside active Unit root");
  }

  if (!existsSync(absolutePath)) {
    return unavailable(path, absolutePath, "missing", source, "file does not exist in the active Unit root");
  }

  let stat;
  try {
    stat = statSync(absolutePath);
  } catch {
    return unavailable(path, absolutePath, "missing", source, "file could not be inspected");
  }

  if (stat.isDirectory()) {
    return unavailable(path, absolutePath, "directory", source, "directory selectors are not whole files");
  }
  if (!stat.isFile()) {
    return unavailable(path, absolutePath, "unresolved selector", source, "path is not a regular file");
  }
  if (stat.size > WHOLE_FILE_OBSERVATION_MAX_BYTES) {
    return unavailable(
      path,
      absolutePath,
      "over-threshold",
      source,
      `${formatSize(stat.size)} exceeds ${formatSize(WHOLE_FILE_OBSERVATION_MAX_BYTES)}`,
    );
  }

  let buffer: Buffer;
  try {
    buffer = readFileSync(absolutePath);
  } catch {
    return unavailable(path, absolutePath, "missing", source, "file could not be read");
  }

  if (isBinaryOrImage(buffer)) {
    return unavailable(path, absolutePath, "binary/image", source, "binary or image files are not inlined as source text");
  }

  const text = buffer.toString("utf8");
  const lines = countLines(text);
  if (lines > WHOLE_FILE_OBSERVATION_MAX_LINES) {
    return unavailable(
      path,
      absolutePath,
      "over-threshold",
      source,
      `${lines} lines exceeds ${WHOLE_FILE_OBSERVATION_MAX_LINES}`,
    );
  }

  return {
    path,
    absolutePath,
    status: "whole",
    source,
    text,
    bytes: buffer.byteLength,
    lines,
  };
}

export function injectSourceContextBlockIntoPayload(
  payload: Record<string, unknown>,
  block: string,
): Record<string, unknown> {
  const messages = payload.messages;
  if (Array.isArray(messages)) {
    return {
      ...payload,
      messages: [
        ...withoutExistingSourceContextMessages(messages),
        { role: "user", content: [{ type: "text", text: block }] },
      ],
    };
  }

  const input = payload.input;
  if (Array.isArray(input)) {
    return {
      ...payload,
      input: [
        ...withoutExistingSourceContextItems(input),
        { role: "user", content: [{ type: "input_text", text: block }] },
      ],
    };
  }

  return payload;
}

function unavailable(
  path: string,
  absolutePath: string | null,
  status: Exclude<SourceObservationStatus, "whole">,
  source: SourceObservationSource,
  reason?: string,
): SourceObservation {
  return { path, absolutePath, status, source, reason };
}

function formatObservationPath(basePath: string, absolutePath: string, fallback: string): string {
  const rel = relative(basePath, absolutePath);
  if (rel && !rel.startsWith("..") && !isAbsolute(rel)) {
    return rel.split(sep).join("/");
  }
  return fallback;
}

function isPathInsideRoot(rootPath: string, absolutePath: string): boolean {
  const rel = relative(rootPath, absolutePath);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function containsGlobPattern(candidate: string): boolean {
  return ["*", "?", "[", "]", "{", "}"].some((char) => candidate.includes(char));
}

function readPathFromInput(input: { path?: unknown; file_path?: unknown }): string {
  if (typeof input.path === "string") return input.path;
  if (typeof input.file_path === "string") return input.file_path;
  return "";
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function isBinaryOrImage(buffer: Buffer): boolean {
  if (buffer.includes(0)) return true;
  if (startsWith(buffer, [0xff, 0xd8, 0xff])) return true;
  if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return true;
  if (startsWithAscii(buffer, "GIF")) return true;
  if (
    startsWithAscii(buffer, "RIFF") &&
    buffer.length >= 12 &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) return true;
  return false;
}

function startsWith(buffer: Buffer, signature: readonly number[]): boolean {
  if (buffer.length < signature.length) return false;
  return signature.every((byte, index) => buffer[index] === byte);
}

function startsWithAscii(buffer: Buffer, text: string): boolean {
  return buffer.length >= text.length && buffer.subarray(0, text.length).toString("ascii") === text;
}

function countLines(text: string): number {
  if (text.length === 0) return 0;
  return text.endsWith("\n") ? text.split("\n").length - 1 : text.split("\n").length;
}

function fencedSource(text: string): string {
  const longest = longestBacktickRun(text);
  const fence = longest >= 3 ? "`".repeat(longest + 1) : "```";
  return `${fence}\n${text}\n${fence}`;
}

function longestBacktickRun(text: string): number {
  let longest = 0;
  let current = 0;
  for (const char of text) {
    if (char === "`") {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }
  return longest;
}

function firstText(content: unknown): string | null {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  const block = content.find((entry) =>
    entry && typeof entry === "object" && "text" in entry,
  ) as { text?: unknown } | undefined;
  return typeof block?.text === "string" ? block.text : null;
}

function isSourceContextMessage(message: unknown): boolean {
  if (!message || typeof message !== "object") return false;
  return firstText((message as { content?: unknown }).content)?.startsWith(SOURCE_CONTEXT_TITLE) === true;
}

function withoutExistingSourceContextMessages(messages: unknown[]): unknown[] {
  return messages.filter((message) => !isSourceContextMessage(message));
}

function withoutExistingSourceContextItems(items: unknown[]): unknown[] {
  return items.filter((item) => !isSourceContextMessage(item));
}
