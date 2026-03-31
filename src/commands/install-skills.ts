import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Templates are at the package root: ../../templates/ (from dist/commands/)
function getTemplatesDir(): string {
  // Walk up from dist/commands/ to package root
  let dir = __dirname;
  while (dir !== "/") {
    const candidate = join(dir, "templates");
    if (existsSync(candidate)) return candidate;
    dir = dirname(dir);
  }
  throw new Error("Cannot find templates directory. Is the package installed correctly?");
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
      destRel: "50-backlog/backlog.base",
    });
  }

  return entries;
}

export function cmdInstallSkills(
  vaultRoot: string,
  args: { all?: boolean; list?: boolean; update?: boolean }
): void {
  const available = listAvailable();

  if (args.list) {
    console.log("Available templates:\n");
    for (const entry of available) {
      console.log(`  [${entry.type}] ${entry.name} → ${entry.destRel}`);
    }
    return;
  }

  if (!args.all) {
    console.log("Usage: vt install-skills --all    Install all skills, rules, and templates");
    console.log("       vt install-skills --list   List available templates");
    console.log("       vt install-skills --update Overwrite existing base files (preserves .local.md)");
    return;
  }

  let installed = 0;
  let skipped = 0;

  for (const entry of available) {
    const destPath = resolve(vaultRoot, entry.destRel);
    const destDir = dirname(destPath);

    // Never overwrite unless --update
    if (existsSync(destPath) && !args.update) {
      console.log(`  Exists (skip): ${entry.destRel}`);
      skipped++;
      continue;
    }

    mkdirSync(destDir, { recursive: true });
    copyFileSync(entry.src, destPath);
    console.log(`  Installed: ${entry.destRel}`);
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
