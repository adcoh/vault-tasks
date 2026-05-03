export type { Task, CreateTaskOpts } from "./task.js";
export type { Config, LintConfig, LintEvergreenConventions } from "./config.js";
export { TaskStore } from "./store.js";
export { loadConfig, findConfigFile } from "./config.js";
export { parseFrontmatter, writeFrontmatter } from "./frontmatter.js";
export { slugify } from "./slugify.js";
export { generateUlid, isValidUlid } from "./ulid.js";

export {
  lintVault,
  buildIndex,
  resolveTarget,
  stripTargetSuffixes,
  normKey,
  collectWikilinks,
  readVaultFiles,
  isTemplatePlaceholder,
  findBrokenLinks,
  buildInboundMap,
  findOrphanEvergreens,
  findStaleReferences,
  findEvergreenDrift,
  attachSuggestions,
  computeLeverageFixes,
  formatHumanReport,
  formatJsonReport,
  formatSummaryLine,
} from "./lint/index.js";

export type {
  LintReport,
  LintOptions,
  WikiLink,
  VaultFile,
  ResolutionIndex,
  Suggestion,
  BrokenEntry,
  LeverageFix,
  DriftEntry,
  CheckName,
} from "./lint/types.js";
