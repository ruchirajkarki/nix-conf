# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Operating principle

When asked to install, configure, or change something on this machine, always prefer expressing it declaratively in this Nix config (`modules/`, `home/`) over doing it manually or out-of-band. Only fall back to a manual/imperative step when it genuinely can't be done through the Nix config (e.g. one-time interactive setup, GUI-only license activation, secrets) — and in that case, tell me explicitly that it's not possible from the config and what I need to do by hand instead. Don't silently do something outside the config.

## What this is

A personal `nix-darwin` + `home-manager` flake that declaratively configures a single macOS machine (`Ruchis-MacBook-Air`, `aarch64-darwin`, user `ruchirajkarki`). System-level state (Homebrew, macOS defaults, users) lives in `modules/`; user-level dotfiles/tooling live in `home/`.

## Commands

- `make deploy` — build and switch (requires `sudo`). The standard way to apply changes.
- `make build` — build only; use it to verify a change evaluates/builds before applying.
- `make dry-run` — build, then preview what a switch would change.
- `make check` — `nix flake check`.
- `make fmt` — format all `.nix` files with Alejandra (`nix fmt .`; bare `nix fmt` reads stdin). Run before committing.
- `make gc` — prune generations older than 14 days and GC/optimise the store right now.

New files must be `git add`ed (or `git add -N`) before Nix can see them. There is no test suite; correctness is verified by `make build` / `make check` succeeding and, for risky changes, a dry run.

## Architecture

Nix is installed and managed by **Determinate Nix**, so `nix.enable = false`. That makes `nix.settings`, `nix.gc` and `nix.optimise` unusable: daemon settings belong in `/etc/nix/nix.custom.conf`, and GC is a custom launchd daemon (`org.nixos.nix-gc`, weekly) in `modules/nix-core.nix`.

Entry point is `flake.nix`: it pins `hostname`, `username`, and `useremail` as local `let` bindings and threads them into every module via `specialArgs`. The `darwinConfigurations.<hostname>` output composes:

1. **System modules** (`modules/`):
   - `nix-core.nix` — nixpkgs settings, plus the weekly Nix GC daemon and the Homebrew cache-cleanup agent.
   - `system.nix` — macOS defaults (Dock, Finder, trackpad, keyboard, screenshots, login window, etc). Prefer typed `system.defaults.*` options; use `CustomUserPreferences` only for keys nix-darwin has no option for.
   - `packages.nix` — `environment.systemPackages` (plain nixpkgs CLI tools) and `fonts.packages`.
   - `homebrew.nix` — `nix-homebrew` (the Homebrew install itself) and the `homebrew` block (`brews`/`casks`). `onActivation.cleanup = "zap"` means anything removed from this list is uninstalled, app data included, on the next deploy.
   - `host-users.nix` — hostname/computerName and the macOS user account.
2. **home-manager** — `home/default.nix` imports the per-concern user modules (`shell.nix`, `core.nix`, `node.nix`, `git.nix`, `gh.nix`, `starship.nix`, `fzf-bat.nix`, `neovim.nix`). The Neovim Lua config lives in `home/nvim/` and is linked to `~/.config/nvim`.

Where things go: a tool with a home-manager `programs.*` module is configured in `home/` (don't also list it as a package); plain packages go in `modules/packages.nix`; GUI apps and anything missing from nixpkgs go in `modules/homebrew.nix`.

Because `specialArgs = inputs // {inherit username useremail hostname;}`, every module (system and home-manager alike) can destructure `username`, `useremail`, `hostname`, plus any flake input, directly from its function arguments — that's the mechanism that keeps the machine identity centralized in `flake.nix` instead of duplicated across modules.

`home/git.nix` pulls in `gitalias` (170+ short git aliases) and `home/gh.nix` pulls in `awesome-gh-aliases` for the GitHub CLI; both are documented in full in `README.md` if alias behavior needs to be looked up.

`scripts/install-rosetta.sh` / `uninstall-rosetta.sh` are wrapped into packages via `writeShellScriptBin` in `packages.nix` and exposed as the `install-rosetta` / `uninstall-rosetta` commands in the resulting system.

## Conventions

- Format Nix files with `nix fmt` (Alejandra); 2-space indentation, trailing commas, sorted attributes where practical.
- Name modules kebab-case (e.g. `homebrew-mirror.nix`).
- Keep system-wide concerns in `modules/`, user-specific/dotfile concerns in `home/` — don't cross-contaminate.
- Commit messages follow Conventional Commits (`feat(home): ...`, `fix(modules): ...`).
- Before committing: run `nix build` for the host and `nix flake check`. When touching `home/git.nix` specifically, be aware activation overwrites `~/.gitconfig`.
- Never commit secrets; verify `hostname`, `username`, `useremail` in `flake.nix` are correct before deploying.

## Project Agents & Special Implementations

### DeepSeek Integration
- **Implementation**: Created a `claude-deep` wrapper function in `home/shell.nix`.
- **Purpose**: Allows using the Claude CLI with DeepSeek's Anthropic-compatible API.
- **Mechanism**: Overrides `ANTHROPIC_BASE_URL` to `https://api.deepseek.com/anthropic` and reads the API key from `~/.config/deepseek.env`.
- **Model Mapping**: Default models (Sonnet/Opus/Haiku) are mapped to `deepseek-flash`.
- **Switching**: Use `claude-deep-flash` or `claude-deep-pro` aliases.

### Tavily Integration
- **Purpose**: Web search and research capabilities for the agent.
- **CLI**: Installed via `pipx install tavily-cli`.
- **Skills**: Installed via `npx skills add tavily-ai/skills`.
- **Auth**: Managed via `tvly login`.
