import { join, normalize } from "node:path"

import { sessionsDir as defaultSessionsDir } from "./app-paths.js"

export function getProjectSessionsDir(cwd: string, baseSessionsDir = defaultSessionsDir): string {
  // Normalize the cwd path to prevent directory traversal
  const normalizedCwd = normalize(cwd).replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")
  const safePath = `--${normalizedCwd}--`
  return join(baseSessionsDir, safePath)
}
