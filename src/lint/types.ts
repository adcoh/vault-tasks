/**
 * Public types for the vault-tasks lint engine.
 *
 * The engine is read-only by design: it walks the vault, builds an index of
 * resolvable wikilink targets, and reports issues. It never mutates files.
 */

/** A single wikilink occurrence in a file. */
export interface WikiLink {
  /** Resolution key — alias and anchor stripped. */
  target: string;
  /** Vault-relative source file. */
  source: string;
  /** 1-based line number. */
  line: number;
}

/** A file as seen by the linter. */
export interface VaultFile {
  /** Vault-relative path including .md extension. */
  relPath: string;
  /** Absolute path on disk. */
  absPath: string;
  /** title: from frontmatter, or null. */
  title: string | null;
  /** aliases: from frontmatter, normalised to a string array. */
  aliases: string[];
  /** Whether the file has any frontmatter block at all. */
  hasFrontmatter: boolean;
  /** Whether `tags:` appears as a frontmatter key (any value). */
  hasTagsField: boolean;
  /** Body text (post-frontmatter). */
  body: string;
  /** Full text including frontmatter, normalised to LF. */
  text: string;
  /**
   * Per-file lint opt-outs read from frontmatter — flat keys to keep the
   * minimal YAML parser sufficient. Setting any of these to a truthy value
   * excludes the file from the corresponding check.
   */
  lintOpts: {
    orphanOk: boolean;
    staleOk: boolean;
    driftOk: boolean;
  };
}

/** Index used for resolving wikilink targets. */
export interface ResolutionIndex {
  /** Normalised key → list of vault-relative paths registered under that key. */
  exact: Map<string, string[]>;
  /** Normalised multi-component path-tail key → list of paths. */
  tail: Map<string, string[]>;
  /** All known files, in walk order. */
  files: VaultFile[];
  /** Lookup: vault-relative path → VaultFile. */
  byPath: Map<string, VaultFile>;
  /** Collisions: normalised key → distinct paths sharing that key. */
  collisions: Map<string, string[]>;
}

/** A "did you mean?" suggestion for a broken wikilink target. */
export interface Suggestion {
  /** Vault-relative path of the suggested file. */
  filePath: string;
  /** The candidate string that matched (a basename, title, or alias). */
  candidate: string;
  /** What kind of candidate matched. */
  kind: "basename" | "title" | "alias";
  /** Trigram similarity, 0..1. */
  similarity: number;
  /**
   * The proposed alias to add to filePath's frontmatter to close all
   * occurrences of the broken target. Always equal to the broken target.
   */
  proposedAlias: string;
}

/** Aggregated entry for a single broken target. */
export interface BrokenEntry {
  target: string;
  count: number;
  locations: Array<{ source: string; line: number }>;
  suggestions: Suggestion[];
}

/** A "high-leverage fix" — applying it would close many broken links at once. */
export interface LeverageFix {
  /** Action description, e.g. "add alias to 10-areas/foo/CONTEXT.md". */
  action: string;
  /** Number of broken links this fix would resolve. */
  closes: number;
  /** Vault-relative file path the fix would mutate. */
  filePath: string;
  /** Aliases to add (or filename to create). */
  aliases: string[];
}

/** Single drift finding. */
export interface DriftEntry {
  filePath: string;
  issues: string[];
}

/** Full lint report. */
export interface LintReport {
  broken: BrokenEntry[];
  orphans: string[];
  stale: string[];
  drift: DriftEntry[];
  leverageFixes: LeverageFix[];
  warnings: string[];
  /** Counts for the SUMMARY line. */
  summary: {
    broken: number;
    orphans: number;
    stale: number;
    drift: number;
  };
  /** True if the report has any issues. */
  hasIssues: boolean;
}

/** Runtime options for a lint run. */
export interface LintOptions {
  /** Restrict to files under this vault-relative subdir. */
  scope?: string;
  /** Run only this check. */
  only?: "broken" | "orphans" | "stale" | "drift";
  /** Skip the suggestion engine (faster). */
  noSuggestions?: boolean;
  /** Report warnings sink (defaults to console.error). */
  onWarn?: (msg: string) => void;
}

export type CheckName = "broken" | "orphans" | "stale" | "drift";
