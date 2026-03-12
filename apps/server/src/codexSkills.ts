import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { SkillId, SkillReference, SkillSearchPath } from "@t3tools/contracts";

function trimYamlScalar(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function parseSkillFrontmatter(content: string): { name?: string; description?: string } {
  if (!content.startsWith("---")) {
    return {};
  }
  const endIndex = content.indexOf("\n---", 3);
  if (endIndex < 0) {
    return {};
  }
  const frontmatter = content.slice(4, endIndex).split("\n");
  let name: string | undefined;
  let description: string | undefined;

  for (const rawLine of frontmatter) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }
    const separatorIndex = line.indexOf(":");
    if (separatorIndex < 0) {
      continue;
    }
    const key = line.slice(0, separatorIndex).trim();
    const value = trimYamlScalar(line.slice(separatorIndex + 1));
    if (key === "name" && value.length > 0) {
      name = value;
      continue;
    }
    if (key === "description" && value.length > 0) {
      description = value;
    }
  }

  const parsed: { name?: string; description?: string } = {};
  if (name !== undefined) {
    parsed.name = name;
  }
  if (description !== undefined) {
    parsed.description = description;
  }
  return parsed;
}

async function findSkillMarkdownFiles(root: string): Promise<string[]> {
  const stack = [root];
  const results: string[] = [];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }

    let entries: Array<import("node:fs").Dirent<string>>;
    try {
      entries = await fs.readdir(current, { encoding: "utf8", withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(absolutePath);
        continue;
      }
      if (entry.isFile() && entry.name === "SKILL.md") {
        results.push(absolutePath);
      }
    }
  }

  return results;
}

function normalizeSkillId(skillsRoot: string, markdownPath: string): SkillId {
  const relativeDir = path.relative(skillsRoot, path.dirname(markdownPath));
  return relativeDir.split(path.sep).join("/") as SkillId;
}

async function readSkillReference(
  skillsRoot: string,
  markdownPath: string,
): Promise<SkillReference> {
  const content = await fs.readFile(markdownPath, "utf8");
  const id = normalizeSkillId(skillsRoot, markdownPath);
  const { name, description } = parseSkillFrontmatter(content);
  const system = path.dirname(markdownPath).split(path.sep).includes(".system");
  return {
    id,
    name: (name && name.trim().length > 0
      ? name.trim()
      : path.basename(path.dirname(markdownPath))) as SkillReference["name"],
    description: description?.trim() ?? "",
    path: markdownPath as SkillReference["path"],
    system,
  };
}

function expandHomeLikePath(rawPath: string): string {
  return rawPath === "~"
    ? os.homedir()
    : rawPath.startsWith("~/") || rawPath.startsWith("~\\")
      ? path.join(os.homedir(), rawPath.slice(2))
      : rawPath;
}

export async function resolveCodexSkillsRoot(homePath?: string): Promise<string> {
  const rawHomePath =
    homePath && homePath.trim().length > 0
      ? homePath.trim()
      : process.env.CODEX_HOME && process.env.CODEX_HOME.trim().length > 0
        ? process.env.CODEX_HOME.trim()
        : path.join(os.homedir(), ".codex");
  return path.resolve(path.join(expandHomeLikePath(rawHomePath), "skills"));
}

export async function resolveCodexSkillRoots(input: {
  readonly homePath?: string;
  readonly skillPaths?: ReadonlyArray<SkillSearchPath>;
}): Promise<readonly string[]> {
  const roots = [await resolveCodexSkillsRoot(input.homePath)];
  for (const skillPath of input.skillPaths ?? []) {
    const trimmed = skillPath.trim();
    if (!trimmed) {
      continue;
    }
    roots.push(path.resolve(expandHomeLikePath(trimmed)));
  }

  const uniqueRoots: string[] = [];
  const seen = new Set<string>();
  for (const root of roots) {
    if (seen.has(root)) {
      continue;
    }
    seen.add(root);
    uniqueRoots.push(root);
  }
  return uniqueRoots;
}

export async function listCodexSkills(input: {
  readonly homePath?: string;
  readonly skillPaths?: ReadonlyArray<SkillSearchPath>;
  readonly includeSystem?: boolean;
}): Promise<SkillReference[]> {
  const skillRoots = await resolveCodexSkillRoots(input);
  const skills: SkillReference[] = [];
  const seenIds = new Set<SkillId>();

  for (const skillsRoot of skillRoots) {
    const markdownPaths = await findSkillMarkdownFiles(skillsRoot);
    const resolvedSkills = await Promise.all(
      markdownPaths.map((markdownPath) => readSkillReference(skillsRoot, markdownPath)),
    );

    for (const skill of resolvedSkills) {
      if (seenIds.has(skill.id)) {
        continue;
      }
      seenIds.add(skill.id);
      skills.push(skill);
    }
  }

  return skills
    .filter((skill) => input.includeSystem === true || !skill.system)
    .toSorted((left, right) => {
      if (left.system !== right.system) {
        return left.system ? 1 : -1;
      }
      return left.name.localeCompare(right.name) || left.id.localeCompare(right.id);
    });
}

export async function resolveCodexSkillsById(input: {
  readonly homePath?: string;
  readonly skillPaths?: ReadonlyArray<SkillSearchPath>;
  readonly skillIds: ReadonlyArray<SkillId>;
}): Promise<{ readonly skills: SkillReference[]; readonly missingSkillIds: SkillId[] }> {
  const skills = await listCodexSkills({
    ...(input.homePath !== undefined ? { homePath: input.homePath } : {}),
    ...(input.skillPaths !== undefined ? { skillPaths: input.skillPaths } : {}),
    includeSystem: true,
  });
  const skillsById = new Map(skills.map((skill) => [skill.id, skill] as const));
  const resolvedSkills: SkillReference[] = [];
  const missingSkillIds: SkillId[] = [];

  for (const skillId of input.skillIds) {
    const skill = skillsById.get(skillId);
    if (!skill) {
      missingSkillIds.push(skillId);
      continue;
    }
    resolvedSkills.push(skill);
  }

  return {
    skills: resolvedSkills,
    missingSkillIds,
  };
}
