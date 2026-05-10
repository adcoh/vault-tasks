"""Python entry point for the vault-tasks CLI.

The pip wheel ships the compiled JS at vault_tasks/_bundle/dist/cli.js plus
the templates tree at vault_tasks/_bundle/templates/. This shim:

  1. Locates `node` on PATH (errors actionably if missing).
  2. Sets VAULT_TASKS_TEMPLATES_DIR so install-skills finds the bundled
     templates instead of walking up from __dirname.
  3. Execs `node cli.js <forwarded argv>`. On POSIX we use os.execvpe so
     signals (Ctrl-C) and exit codes pass through cleanly. On Windows we
     fall back to subprocess.run because execvpe semantics there are
     different enough to cause shell-related surprises.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

NODE_MISSING_MESSAGE = (
    "vault-tasks: Node.js is required but was not found on PATH.\n"
    "\n"
    "vault-tasks ships as JavaScript and needs Node.js >= 20 to run.\n"
    "Install Node from https://nodejs.org or via your package manager:\n"
    "  macOS:    brew install node\n"
    "  Ubuntu:   sudo apt install nodejs\n"
    "  Windows:  winget install OpenJS.NodeJS.LTS\n"
    "Then re-run this command.\n"
)


def _bundle_root() -> Path:
    return Path(__file__).resolve().parent / "_bundle"


def _find_node() -> str:
    node = shutil.which("node")
    if not node:
        sys.stderr.write(NODE_MISSING_MESSAGE)
        sys.exit(127)
    return node


def main() -> None:
    node = _find_node()
    bundle = _bundle_root()
    cli_js = bundle / "dist" / "cli.js"
    templates = bundle / "templates"

    if not cli_js.is_file():
        sys.stderr.write(
            f"vault-tasks: bundle is missing cli.js at {cli_js}.\n"
            "The pip wheel appears to be corrupt. Try `pip install --force-reinstall vault-tasks`.\n"
        )
        sys.exit(1)
    if not templates.is_dir():
        sys.stderr.write(
            f"vault-tasks: bundle is missing templates at {templates}.\n"
            "The pip wheel appears to be corrupt. Try `pip install --force-reinstall vault-tasks`.\n"
        )
        sys.exit(1)

    env = os.environ.copy()
    env["VAULT_TASKS_TEMPLATES_DIR"] = str(templates)

    argv = [node, str(cli_js), *sys.argv[1:]]

    if os.name == "nt":
        # Windows: subprocess.run preserves stdio/exit-code semantics best.
        # Pass argv as a list so the shell does not re-quote anything.
        completed = subprocess.run(argv, env=env)
        sys.exit(completed.returncode)

    # POSIX: replace the Python process so signals and exit codes pass through.
    os.execvpe(node, argv, env)


if __name__ == "__main__":
    main()
