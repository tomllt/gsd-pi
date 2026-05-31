import { join } from "node:path";

import { gsdRoot } from "./paths.js";
import { readEvents } from "./workflow-events.js";

export function latestExplicitReopenAt(basePath: string, milestoneId: string): string | null {
  const root = gsdRoot(basePath);
  const candidates = [
    join(root, "event-log.jsonl"),
    join(root, `event-log-${milestoneId}.jsonl.archived`),
  ];

  let latest: string | null = null;
  for (const file of candidates) {
    for (const event of readEvents(file)) {
      const eventMilestoneId = (event.params as { milestoneId?: unknown }).milestoneId;
      if (event.cmd !== "reopen-milestone" || eventMilestoneId !== milestoneId) continue;
      if (!latest || event.ts > latest) latest = event.ts;
    }
  }
  return latest;
}

export function isAfter(value: string | null | undefined, cutoff: string | null): boolean {
  if (!cutoff) return true;
  if (!value) return true;
  return Date.parse(value) > Date.parse(cutoff);
}
