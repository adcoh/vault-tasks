/**
 * Convert a title to a kebab-case slug, truncated at word boundaries.
 */
export function slugify(title: string, maxLength = 60): string {
  let slug = title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/[\s]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  // Fallback for empty or all-special-character titles
  if (!slug) {
    return "untitled";
  }

  if (slug.length <= maxLength) {
    return slug;
  }

  // Truncate at word boundary (hyphen), fall back to hard truncation
  const truncated = slug.slice(0, maxLength);
  const lastHyphen = truncated.lastIndexOf("-");
  if (lastHyphen > 0) {
    return truncated.slice(0, lastHyphen);
  }
  return truncated;
}
