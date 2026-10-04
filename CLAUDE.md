# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Operating principle

When asked to install, configure, or change something on this machine, always prefer expressing it declaratively in this Nix config (`modules/`, `home/`) over doing it manually or out-of-band. Only fall back to a manual/imperative step when it genuinely can't be done through the Nix config (e.g. one-time interactive setup, GUI-only license activation, secrets) — and in that case, tell me explicitly that it's not possible from the config and what I need to do by hand instead. Don't silently do something outside the config.

## What this is

A personal `nix-darwin` + `home-manager` flake that declaratively configures a single macOS machine (`Ruchis-MacBook-Air`, `aarch64-darwin`, user `ruchirajkarki`). System-level state (Homebrew, macOS defaults, users) lives in `modules/`; user-level dotfiles/tooling live in `home/`.

## Commands

- `make deploy` — build and switch (`nix build` then `sudo ./result/sw/bin/darwin-rebuild switch --flake .#Ruchis-MacBook-Air`). This is the standard way to apply changes.
- `nix build .#darwinConfigurations.Ruchis-MacBook-Air.system --extra-experimental-features 'nix-command flakes'` — build only, without switching; use this to verify a change evaluates/builds before applying it.
- `./result/sw/bin/darwin-rebuild switch --flake .#Ruchis-MacBook-Air` — apply an already-built result (requires `sudo`).
- `darwin-rebuild switch --flake .#Ruchis-MacBook-Air --dry-run` — preview what a switch would change.
- `nix flake check` — validate the flake (evaluation checks).
- `nix fmt` — format all `.nix` files with Alejandra (the configured `formatter`). Run this before committing Nix changes.

There is no test suite; correctness is verified by `nix build` / `nix flake check` succeeding and, for risky changes, a dry-run switch.

## Architecture

Entry point is `flake.nix`: it pins `hostname`, `username`, and `useremail` as local `let` bindings and threads them into every module via `specialArgs`. The `darwinConfigurations.<hostname>` output composes:

1. **System modules** (`modules/`), imported directly into `darwinSystem`:
   - `nix-core.nix` — core Nix daemon settings (flakes enabled, unfree allowed).
   - `system.nix` — macOS defaults (Dock, trackpad, keyboard, Finder, login window, etc).
   - `apps.nix` — all package installation: `environment.systemPackages` (nixpkgs CLI tools) plus the `homebrew` block (`brews`/`casks`/`masApps`). GUI apps and anything not in nixpkgs go here as Homebrew casks; `onActivation.cleanup = "zap"` means casks removed from this list get uninstalled on the next `deploy`.
   - `host-users.nix` — hostname/computerName and the macOS user account, parameterized by the `hostname`/`username` passed via `specialArgs`.
2. **nix-homebrew module** — manages the Homebrew installation itself (separate from `apps.nix`, which manages what Homebrew installs); configured inline in `flake.nix`.
3. **home-manager module** — bridges to `home/default.nix`, which imports the per-concern user modules (`shell.nix`, `core.nix`, `node.nix`, `git.nix`, `gh.nix`, `starship.nix`, `fzf-bat.nix`, `neovim.nix`). `useGlobalPkgs`/`useUserPackages` are enabled so Home Manager shares the system `nixpkgs` evaluation.

Because `specialArgs = inputs // {inherit username useremail hostname;}`, every module (system and home-manager alike) can destructure `username`, `useremail`, `hostname`, plus any flake input, directly from its function arguments — that's the mechanism that keeps the machine identity centralized in `flake.nix` instead of duplicated across modules.

`home/git.nix` pulls in `gitalias` (170+ short git aliases) and `home/gh.nix` pulls in `awesome-gh-aliases` for the GitHub CLI; both are documented in full in `README.md` if alias behavior needs to be looked up.

`scripts/install-rosetta.sh` / `uninstall-rosetta.sh` are wrapped into packages via `writeShellScriptBin` in `apps.nix` and exposed as the `install-rosetta` / `uninstall-rosetta` commands in the resulting system.

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
