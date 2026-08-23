/**
 * Vault walking, frontmatter extraction, and wikilink collection.
 *
 * Code-block awareness:
 * - Triple-backtick fenced blocks are tracked line-by-line and skipped.
 * - Inline `code spans` are stripped from each non-fenced line before regex
 *   scanning.
 *
 * Limitations (acceptable for vault-scale audits; called out for future me):
 * - Inline code regex uses a single backtick per side. Backtick-escaped
 *   sequences and double/triple inline spans are not handled.
 * - Fenced-block tracking does not match opening/closing fence lengths.
 *   `~~~`-fenced blocks are also not recognised.
 */

import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join, posix as posixPath, relative, sep } from "node:path";
import { parseFrontmatter } from "../frontmatter.js";
import { stripTargetSuffixes } from "./resolve.js";
import type { VaultFile, WikiLink } from "./types.js";

const WIKILINK_RE = /\[\[([^\]\n]+?)\]\]/g;
const INLINE_CODE_RE = /`[^`\n]*`/g;
/** `[text](href)` — href ends at whitespace (an optional "title") or `)`. */
const MD_LINK_RE = /\[[^\]\n]*\]\(\s*<?([^)>\s]+)>?[^)\n]*\)/g;
/** A URI scheme (`https:`, `mailto:`) or a protocol-relative `//` prefix. */
const EXTERNAL_RE = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

function toRelPosix(absPath: string, vaultRoot: string): string {
  return relative(vaultRoot, absPath).split(sep).join("/");
}

function pathHitsSkipDir(relPosix: string, skipDirs: string[]): boolean {
  for (const d of skipDirs) {
    const trimmed = d.replace(/\/+$/, "");
    if (!trimmed) continue;
    if (relPosix === trimmed) return true;
    if (relPosix.startsWith(`${trimmed}/`)) return true;
    if (relPosix.includes(`/${trimmed}/`)) return true;
  }
  return false;
}

/**
 * Recursively walk the vault and yield .md files, respecting skipDirs.
 *
 * Symlinks are deliberately NOT followed: a symlinked directory inside the
 * vault could otherwise point at `/etc` or any other location outside the
 * vault root, and a read-only audit has no business resolving them. We use
 * `lstatSync` (not `statSync`) so symlinks report as symlinks rather than
 * as their resolved target, and skip them. As an additional defence, we
 * verify each candidate stays under the vault root via `relative()` — this
 * catches any hardlinks or weird mount situations that lstat might miss.
 */
export function walkMarkdown(
  vaultRoot: string,
  skipDirs: string[],
  onWarn: (msg: string) => void
): string[] {
  const out: string[] = [];

  const recurse = (dir: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch (err) {
      onWarn(`could not read directory ${dir}: ${(err as Error).message}`);
      return;
    }

    for (const name of entries) {
      const abs = join(dir, name);

      // Containment check: relative path must not start with `..`. This
      // is a belt-and-suspenders check — `join()` collapses `..` segments,
      // so this can only fire for genuinely escaping paths.
      const rel = toRelPosix(abs, vaultRoot);
      if (rel.startsWith("../") || rel === "..") {
        onWarn(`skipping path outside vault root: ${abs}`);
        continue;
      }

      let st: ReturnType<typeof lstatSync>;
      try {
        st = lstatSync(abs);
      } catch {
        continue;
      }

      // Skip symlinks (regardless of target). Following them risks reading
      // outside the vault root and creating cycles.
      if (st.isSymbolicLink()) {
        continue;
      }

      if (pathHitsSkipDir(rel, skipDirs)) continue;
      if (st.isDirectory()) {
        recurse(abs);
      } else if (st.isFile() && name.endsWith(".md")) {
        out.push(abs);
      }
    }
  };

  recurse(vaultRoot);
  out.sort();
  return out;
}

function extractAliases(meta: Record<string, unknown>): string[] {
  const raw = meta["aliases"];
  if (Array.isArray(raw)) {
    return raw.map((v) => String(v)).filter((s) => s.length > 0);
  }
  if (typeof raw === "string" && raw.length > 0) {
    return [raw];
  }
  return [];
}

function readBoolFlag(meta: Record<string, unknown>, key: string): boolean {
  const v = meta[key];
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const lc = v.toLowerCase();
    return lc === "true" || lc === "yes" || lc === "ok" || lc === "1";
  }
  return false;
}

/**
 * Read and parse all .md files in the vault into VaultFile records.
 */
export function readVaultFiles(
  vaultRoot: string,
  skipDirs: string[],
  onWarn: (msg: string) => void
): VaultFile[] {
  const absPaths = walkMarkdown(vaultRoot, skipDirs, onWarn);
  const files: VaultFile[] = [];

  for (const abs of absPaths) {
    let text: string;
    try {
      text = readFileSync(abs, "utf-8");
    } catch (err) {
      onWarn(`could not read ${toRelPosix(abs, vaultRoot)}: ${(err as Error).message}`);
      continue;
    }
    const normalised = text.replace(/\r\n/g, "\n");
    const { meta, body } = parseFrontmatter(normalised);
    const hasFrontmatter = Object.keys(meta).length > 0 || normalised.startsWith("---\n");
    const hasTagsField = Object.hasOwn(meta, "tags");
    const titleRaw = meta["title"];
    const title = typeof titleRaw === "string" && titleRaw.length > 0 ? titleRaw : null;

    files.push({
      relPath: toRelPosix(abs, vaultRoot),
      absPath: abs,
      title,
      aliases: extractAliases(meta),
      hasFrontmatter,
      hasTagsField,
      body,
      text: normalised,
      lintOpts: {
        orphanOk: readBoolFlag(meta, "lint_orphan_ok"),
        staleOk: readBoolFlag(meta, "lint_stale_ok"),
        driftOk: readBoolFlag(meta, "lint_drift_ok"),
      },
    });
  }

  return files;
}

/**
 * Determine whether a wikilink target should be skipped because it appears
 * in a documentation file (skill/rule/CLAUDE.md) AND matches a known
 * placeholder pattern.
 */
export function isTemplatePlaceholder(
  target: string,
  source: string,
  templateSourceDirs: string[],
  templateSourceFiles: string[],
  templatePatterns: RegExp[]
): boolean {
  let inTemplateSource = false;
  for (const dir of templateSourceDirs) {
    const trimmed = dir.replace(/\/+$/, "");
    if (!trimmed) continue;
    if (source === trimmed || source.startsWith(`${trimmed}/`)) {
      inTemplateSource = true;
      break;
    }
  }
  if (!inTemplateSource) {
    for (const f of templateSourceFiles) {
      if (source === f) {
        inTemplateSource = true;
        break;
      }
    }
  }
  if (!inTemplateSource) return false;

  for (const re of templatePatterns) {
    if (re.test(target)) return true;
  }
  return false;
}

/**
 * Convert an inline markdown link href into a resolution target, or null if it
 * is not a link to a local markdown file in this vault.
 *
 * Rejects external URLs, protocol-relative hrefs, bare anchors, non-`.md`
 * targets (assets, images), and any relative path that climbs out of the vault
 * root. Otherwise returns a vault-relative path with the `.md` suffix removed,
 * which is exactly the shape the wikilink resolver already understands.
 */
export function mdLinkTarget(href: string, sourceRelPath: string): string | null {
  let h = href.trim();
  if (!h || h.startsWith("#") || EXTERNAL_RE.test(h)) return null;

  h = h.split("#")[0].trim();
  if (!h) return null;
  try {
    h = decodeURIComponent(h);
  } catch {
    // Malformed percent-encoding: fall through with the raw href.
  }
  if (!h.toLowerCase().endsWith(".md")) return null;

  // A leading slash means vault-root-relative, not filesystem-absolute.
  const rootRelative = h.startsWith("/");
  const baseDir = rootRelative ? "." : posixPath.dirname(sourceRelPath);
  const joined = posixPath.normalize(posixPath.join(baseDir, h.replace(/^\/+/, "")));
  if (joined === ".." || joined.startsWith("../")) return null;

  return joined.replace(/\.md$/i, "");
}

/**
 * Scan a list of VaultFile records for links, skipping fenced code blocks and
 * inline code spans, plus any link that matches a template placeholder pattern
 * when it lives in a known template source.
 *
 * Collects both wikilinks and inline markdown links to local `.md` files, each
 * tagged with its `kind`. Wikilinks are stripped from the line before the
 * markdown scan so `[[target|alias]]` cannot be misread as `[text](href)`.
 */
export function collectLinks(
  files: VaultFile[],
  templateSourceDirs: string[],
  templateSourceFiles: string[],
  templatePatterns: string[]
): WikiLink[] {
  const compiled = templatePatterns.map((p) => new RegExp(p));
  const out: WikiLink[] = [];

  const keep = (target: string, source: string): boolean =>
    !isTemplatePlaceholder(target, source, templateSourceDirs, templateSourceFiles, compiled);

  for (const f of files) {
    const lines = f.text.split("\n");
    let inFence = false;
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const stripped = raw.trimStart();
      if (stripped.startsWith("```")) {
        inFence = !inFence;
        continue;
      }
      if (inFence) continue;

      const cleaned = raw.replace(INLINE_CODE_RE, "");

      WIKILINK_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      // biome-ignore lint/suspicious/noAssignInExpressions: canonical global-regex exec() iteration idiom
      while ((m = WIKILINK_RE.exec(cleaned)) !== null) {
        const target = stripTargetSuffixes(m[1]);
        if (!target) continue;
        if (!keep(target, f.relPath)) continue;
        out.push({ target, source: f.relPath, line: i + 1, kind: "wiki" });
      }

      const withoutWikilinks = cleaned.replace(WIKILINK_RE, "");
      MD_LINK_RE.lastIndex = 0;
      // biome-ignore lint/suspicious/noAssignInExpressions: canonical global-regex exec() iteration idiom
      while ((m = MD_LINK_RE.exec(withoutWikilinks)) !== null) {
        const target = mdLinkTarget(m[1], f.relPath);
        if (!target) continue;
        if (!keep(target, f.relPath)) continue;
        out.push({ target, source: f.relPath, line: i + 1, kind: "md" });
      }
    }
  }

  return out;
}

/**
 * Wikilink-only view of {@link collectLinks}, kept for API compatibility.
 */
export function collectWikilinks(
  files: VaultFile[],
  templateSourceDirs: string[],
  templateSourceFiles: string[],
  templatePatterns: string[]
): WikiLink[] {
  return collectLinks(files, templateSourceDirs, templateSourceFiles, templatePatterns).filter(
    (l) => l.kind === "wiki"
  );
}
