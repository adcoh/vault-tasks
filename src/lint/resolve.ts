/**
 * Wikilink resolution — Obsidian-correct, performance-tuned.
 *
 * Resolution rules (mirrors Obsidian; covered by tests):
 * 1. Case-insensitive; whitespace, hyphen, underscore, and colon are
 *    interchangeable in the target. `[[Foo Bar]]`, `[[foo-bar]]`,
 *    `[[FOO_BAR]]` all resolve to the same key.
 * 2. Targets resolve against three sources of truth per file:
 *      - filename stem (basename without `.md`)
 *      - full vault-relative path stem (path without `.md`)
 *      - `title:` frontmatter value
 *      - any value in `aliases:` frontmatter
 * 3. Path-form targets (`[[10-areas/foo/CONTEXT]]`) resolve to the file at
 *    that exact path stem.
 * 4. Partial-path tails resolve when the suffix uniquely identifies a file:
 *    `[[parenting/CONTEXT]]` → `10-areas/parenting/CONTEXT.md` if no other
 *    file ends in `parenting/CONTEXT`. Built from a precomputed tail index
 *    so resolution is O(1) instead of O(N) per link.
 * 5. `|alias` and `#anchor` suffixes are stripped before resolution.
 */

import type { ResolutionIndex, VaultFile } from "./types.js";

/** Strip the `|display-text` and `#section-anchor` suffixes from a target. */
export function stripTargetSuffixes(raw: string): string {
  const noAlias = raw.split("|", 1)[0];
  const noAnchor = noAlias.split("#", 1)[0];
  return noAnchor.trim();
}

/**
 * Normalise a key for resolution lookup: lowercase, strip whitespace,
 * hyphens, underscores, and colons. Slashes are preserved so path-form
 * keys remain distinguishable from flat-name keys.
 */
export function normKey(s: string): string {
  return s.toLowerCase().replace(/[\s\-_:]+/g, "");
}

function pathStem(relPath: string): string {
  return relPath.endsWith(".md") ? relPath.slice(0, -3) : relPath;
}

function basenameOf(relPath: string): string {
  const slash = relPath.lastIndexOf("/");
  const tail = slash >= 0 ? relPath.slice(slash + 1) : relPath;
  return tail.endsWith(".md") ? tail.slice(0, -3) : tail;
}

/**
 * Build the resolution index from a list of vault files.
 *
 * Collisions (multiple files sharing a normalised key) are recorded but do
 * not prevent registration: resolution returns null for collided keys so the
 * link is reported as broken rather than silently mapping to an arbitrary
 * file. This is a deliberate change from the reference Python script, which
 * silently let the last-registered file win.
 */
export function buildIndex(files: VaultFile[]): ResolutionIndex {
  const exact = new Map<string, string[]>();
  const tail = new Map<string, string[]>();
  const byPath = new Map<string, VaultFile>();

  const addExact = (key: string, path: string): void => {
    if (!key) return;
    const list = exact.get(key);
    if (list) {
      if (!list.includes(path)) list.push(path);
    } else {
      exact.set(key, [path]);
    }
  };

  const addTail = (key: string, path: string): void => {
    if (!key) return;
    const list = tail.get(key);
    if (list) {
      if (!list.includes(path)) list.push(path);
    } else {
      tail.set(key, [path]);
    }
  };

  for (const f of files) {
    byPath.set(f.relPath, f);

    const stem = pathStem(f.relPath);
    const base = basenameOf(f.relPath);

    addExact(normKey(base), f.relPath);
    addExact(normKey(stem), f.relPath);

    if (f.title) addExact(normKey(f.title), f.relPath);
    for (const alias of f.aliases) {
      if (alias) addExact(normKey(alias), f.relPath);
    }

    // Tail index: register every multi-component path suffix.
    // For 10-areas/parenting/CONTEXT this registers parenting/CONTEXT.
    // Single-component tails are already covered by basename in `exact`.
    const components = stem.split("/").filter((c) => c !== "");
    for (let i = 1; i < components.length; i++) {
      const suffix = components.slice(i).join("/");
      // Only register multi-component suffixes — single component would be
      // the basename, already handled by exact lookup.
      if (suffix.includes("/")) {
        addTail(normKey(suffix), f.relPath);
      }
    }
  }

  const collisions = new Map<string, string[]>();
  for (const [key, paths] of exact) {
    if (paths.length > 1) collisions.set(key, [...paths]);
  }
  for (const [key, paths] of tail) {
    if (paths.length > 1 && !collisions.has(key)) {
      collisions.set(key, [...paths]);
    }
  }

  return { exact, tail, files, byPath, collisions };
}

/**
 * Resolve a wikilink target to a vault-relative path, or null.
 *
 * Returns null for both "not found" and "ambiguous" — the caller cannot tell
 * the two apart by design. Ambiguous targets must be disambiguated by the
 * author before they have a defined meaning.
 */
export function resolveTarget(
  rawTarget: string,
  index: ResolutionIndex
): string | null {
  const target = stripTargetSuffixes(rawTarget);
  if (!target) return null;

  const key = normKey(target);

  const exactMatches = index.exact.get(key);
  if (exactMatches && exactMatches.length === 1) {
    return exactMatches[0];
  }
  if (exactMatches && exactMatches.length > 1) {
    // Ambiguous: don't guess. The collision is already recorded in
    // index.collisions and surfaced as a warning by the orchestrator.
    return null;
  }

  if (target.includes("/")) {
    const tailMatches = index.tail.get(key);
    if (tailMatches && tailMatches.length === 1) {
      return tailMatches[0];
    }
    // Multiple tail matches → ambiguous → not resolved.
  }

  return null;
}
