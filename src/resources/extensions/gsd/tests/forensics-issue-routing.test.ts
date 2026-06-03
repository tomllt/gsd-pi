import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const promptsDir = join(process.cwd(), "src/resources/extensions/gsd/prompts");

function readPrompt(name: string): string {
  return readFileSync(join(promptsDir, `${name}.md`), "utf-8");
}

test("forensics prompt explicitly forbids github_issues tool for issue creation", () => {
  const prompt = readPrompt("forensics");

  // Must contain an explicit prohibition against using the github_issues tool
  assert.match(
    prompt,
    /Do NOT use the `?github_issues`? tool/i,
    "Prompt must explicitly prohibit the github_issues tool",
  );
});

test("forensics prompt requires gh CLI with --repo open-gsd/gsd-pi for issue creation", () => {
  const prompt = readPrompt("forensics");

  // Must contain the exact gh CLI command with the correct repo flag
  assert.match(
    prompt,
    /gh issue create --repo open-gsd\/gsd-pi/,
    "Prompt must specify gh issue create --repo open-gsd/gsd-pi",
  );
});

test("forensics prompt routes issue creation through bash tool, not github_issues", () => {
  const prompt = readPrompt("forensics");

  // The constraint about using bash tool must be present
  assert.match(
    prompt,
    /`?bash`? tool/i,
    "Prompt must instruct use of the bash tool for issue creation",
  );
});

test("forensics prompt provides paste-once fallback when bash is unavailable", () => {
  const prompt = readPrompt("forensics");

  assert.match(
    prompt,
    /If `bash` is unavailable/i,
    "Prompt must branch when bash cannot be activated",
  );
  assert.match(
    prompt,
    /paste-once shell script/i,
    "Prompt must provide a user-runnable fallback instead of an impossible tool call",
  );
  assert.match(
    prompt,
    /Searching closed issues for possible duplicates/i,
    "Fallback script must preserve the duplicate-search step for the user",
  );
});
