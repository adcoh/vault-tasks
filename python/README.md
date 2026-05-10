# vault-tasks

Markdown-file task manager for solo devs building with Claude Code.

This is the Python distribution of [vault-tasks](https://github.com/adcoh/vault-tasks). It bundles the same compiled JavaScript that ships on npm with a thin Python entry point so you can pin and install it via `pip` or `uv` alongside your other Python project dependencies.

## Requirements

- Python 3.8 or newer
- **Node.js 20 or newer** on `PATH`

The wheel itself is small (~100 KB); it does not bundle the Node.js runtime. If `node` is not found, the CLI prints actionable install instructions and exits.

## Install

```bash
pip install vault-tasks
# or, with uv
uv add --dev vault-tasks
```

This installs two console scripts: `vault-tasks` and the short alias `vt`.

## Usage

```bash
vt new "Wire up CI" --priority high --tags infra,devops
vt list
vt install-skills --list
```

See the [main README](https://github.com/adcoh/vault-tasks#readme) for the full command reference, configuration via `.vault-tasks.toml`, and the Claude Code integration (skills, rules, dashboards).

## License

MIT
