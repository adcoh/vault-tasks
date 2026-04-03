import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Config } from "../config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Templates are at the package root: ../../templates/ (from dist/commands/)
function getTemplatesDir(): string {
  // From dist/commands/, go up two levels to package root
  const packageRoot = resolve(__dirname, "..", "..");
  const templatesDir = join(packageRoot, "templates");
  if (!existsSync(templatesDir)) {
    throw new Error(
      "Cannot find templates directory. Is the package installed correctly?"
    );
  }
  return templatesDir;
}

interface SkillEntry {
  name: string;
  type: "skill" | "rule" | "base";
  src: string;
  destRel: string;
}

function listAvailable(): SkillEntry[] {
  const templatesDir = getTemplatesDir();
  const entries: SkillEntry[] = [];

  // Skills
  const skillsDir = join(templatesDir, "skills");
  if (existsSync(skillsDir)) {
    for (const name of readdirSync(skillsDir)) {
      const skillFile = join(skillsDir, name, "SKILL.md");
      if (existsSync(skillFile)) {
        entries.push({
          name,
          type: "skill",
          src: skillFile,
          destRel: `.claude/skills/${name}/SKILL.md`,
        });
      }
    }
  }

  // Rules
  const rulesDir = join(templatesDir, "rules");
  if (existsSync(rulesDir)) {
    for (const name of readdirSync(rulesDir)) {
      if (name.endsWith(".md")) {
        entries.push({
          name: name.replace(/\.md$/, ""),
          type: "rule",
          src: join(rulesDir, name),
          destRel: `.claude/rules/${name}`,
        });
      }
    }
  }

  // Base files
  const baseFile = join(templatesDir, "backlog.base");
  if (existsSync(baseFile)) {
    entries.push({
      name: "backlog",
      type: "base",
      src: baseFile,
      destRel: "{{backlog_dir}}/backlog.base",
    });
  }

  return entries;
}

export function cmdInstallSkills(
  config: Config,
  args: { install?: boolean; list?: boolean; update?: boolean }
): void {
  const available = listAvailable();
  const placeholders: [RegExp, string][] = [
    [/\{\{backlog_dir\}\}/g, relative(config.vaultRoot, config.backlogDir)],
    [/\{\{journal_dir\}\}/g, relative(config.vaultRoot, config.journalDir)],
    [/\{\{projects_dir\}\}/g, relative(config.vaultRoot, config.projectsDir)],
    [/\{\{evergreen_dir\}\}/g, relative(config.vaultRoot, config.evergreenDir)],
  ];

  function substitute(text: string): string {
    let result = text;
    for (const [pattern, value] of placeholders) {
      result = result.replace(pattern, value);
    }
    return result;
  }

  if (args.list) {
    console.log("Available templates:\n");
    for (const entry of available) {
      const displayRel = substitute(entry.destRel);
      console.log(`  [${entry.type}] ${entry.name} → ${displayRel}`);
    }
    return;
  }

  if (!args.install) {
    console.log("Usage: vt install-skills --install  Install all skills, rules, and templates");
    console.log("       vt install-skills --list   List available templates");
    console.log("       vt install-skills --update Overwrite existing base files (preserves .local.md)");
    return;
  }

  let installed = 0;
  let skipped = 0;

  for (const entry of available) {
    const resolvedDestRel = substitute(entry.destRel);
    const destPath = resolve(config.vaultRoot, resolvedDestRel);
    const destDir = dirname(destPath);

    // Never overwrite unless --update
    if (existsSync(destPath) && !args.update) {
      console.log(`  Exists (skip): ${resolvedDestRel}`);
      skipped++;
      continue;
    }

    mkdirSync(destDir, { recursive: true });

    // Substitute all placeholders with configured paths
    const content = substitute(readFileSync(entry.src, "utf-8"));
    writeFileSync(destPath, content, "utf-8");
    console.log(`  Installed: ${resolvedDestRel}`);
    installed++;
  }

  console.log(
    `\n${installed} installed, ${skipped} skipped (already exist).`
  );

  if (installed > 0) {
    console.log("\nNote: You can customize any skill by creating a SKILL.local.md");
    console.log("file next to the SKILL.md. Local files are never overwritten by updates.");
  }
}
