/**
 * Cross-platform path helpers.
 *
 * The `impl` parameter defaults to the host's `node:path`; tests pass
 * `path.win32` / `path.posix` to exercise Windows semantics on any OS.
 */
import path from "node:path";

type PathImpl = Pick<typeof path, "relative" | "isAbsolute" | "sep">;

/**
 * True if `target` is `root` or lies beneath it.
 *
 * `relative(root, target).startsWith("..")` is not enough: on Windows a
 * target on another drive (`D:\x` vs root `C:\vault`) yields an absolute
 * `relative()` result with no `..`, and a child named `..notes` is wrongly
 * rejected.
 */
export function isInsideRoot(root: string, target: string, impl: PathImpl = path): boolean {
  const rel = impl.relative(root, target);
  if (rel === "") return true;
  if (impl.isAbsolute(rel)) return false;
  return rel !== ".." && !rel.startsWith(`..${impl.sep}`);
}

/** `relative(root, absPath)` with `/` separators on every OS. */
export function toRelPosix(absPath: string, root: string, impl: PathImpl = path): string {
  return impl.relative(root, absPath).split(impl.sep).join("/");
}
