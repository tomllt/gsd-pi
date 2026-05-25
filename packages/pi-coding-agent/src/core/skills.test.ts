import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, parse } from "node:path";
import test from "node:test";

function overrideHomeEnv(homeDir: string): () => void {
	const original = {
		HOME: process.env.HOME,
		USERPROFILE: process.env.USERPROFILE,
		HOMEDRIVE: process.env.HOMEDRIVE,
		HOMEPATH: process.env.HOMEPATH,
	};

	process.env.HOME = homeDir;
	process.env.USERPROFILE = homeDir;

	if (process.platform === "win32") {
		const parsedHome = parse(homeDir);
		process.env.HOMEDRIVE = parsedHome.root.replace(/[\\/]+$/, "");
		const homePath = homeDir.slice(parsedHome.root.length).replace(/\//g, "\\");
		process.env.HOMEPATH = homePath.startsWith("\\") ? homePath : `\\${homePath}`;
	}

	return () => {
		if (original.HOME === undefined) delete process.env.HOME; else process.env.HOME = original.HOME;
		if (original.USERPROFILE === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = original.USERPROFILE;
		if (original.HOMEDRIVE === undefined) delete process.env.HOMEDRIVE; else process.env.HOMEDRIVE = original.HOMEDRIVE;
		if (original.HOMEPATH === undefined) delete process.env.HOMEPATH; else process.env.HOMEPATH = original.HOMEPATH;
	};
}

function writeSkill(root: string, name: string, description: string): string {
	const skillDir = join(root, name);
	mkdirSync(skillDir, { recursive: true });
	const skillPath = join(skillDir, "SKILL.md");
	writeFileSync(skillPath, `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`);
	return skillPath;
}

test("loadSkills prefers GSD bundled skills over user and project collisions", async (t) => {
	const tmp = mkdtempSync(join(tmpdir(), "gsd-skills-precedence-"));
	const restoreHomeEnv = overrideHomeEnv(tmp);
	const originalGsdAgentDir = process.env.GSD_CODING_AGENT_DIR;
	process.env.GSD_CODING_AGENT_DIR = join(tmp, ".gsd", "agent");

	t.after(() => {
		if (originalGsdAgentDir === undefined) delete process.env.GSD_CODING_AGENT_DIR; else process.env.GSD_CODING_AGENT_DIR = originalGsdAgentDir;
		restoreHomeEnv();
		rmSync(tmp, { recursive: true, force: true });
	});

	const gsdSkillPath = writeSkill(join(tmp, ".gsd", "agent", "skills"), "lint", "GSD bundled lint.");
	writeSkill(join(tmp, ".agents", "skills"), "lint", "User lint.");
	writeSkill(join(tmp, "project", ".agents", "skills"), "lint", "Project lint.");

	const { loadSkills } = await import("./skills.js");
	const result = loadSkills({ cwd: join(tmp, "project") });

	const lint = result.skills.find((skill) => skill.name === "lint");
	assert.equal(lint?.filePath, gsdSkillPath);
	assert.equal(
		result.diagnostics.filter((diagnostic) => diagnostic.type === "collision").length,
		2,
		"user and project collisions should be reported while the GSD bundled copy wins",
	);
});
