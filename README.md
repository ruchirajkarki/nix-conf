# nix-conf

Declarative config for `Ruchis-MacBook-Air` (aarch64-darwin): nix-darwin for the
system, home-manager for the user, nix-homebrew for GUI apps. Nix itself is
installed by [Determinate Nix](https://github.com/DeterminateSystems/nix-installer).

## Usage

| Command        | What it does                                                 |
| -------------- | ------------------------------------------------------------ |
| `make deploy`  | build and switch (alias: `nd`)                               |
| `make build`   | build only, to check a change evaluates                      |
| `make dry-run` | build, then show what a switch would change                  |
| `make check`   | `nix flake check`                                            |
| `make fmt`     | format with Alejandra                                        |
| `make update`  | bump flake inputs                                            |
| `make gc`      | prune generations older than 14 days, GC and optimise now    |

Garbage collection also runs on its own every Sunday at 03:00 (launchd job
`org.nixos.nix-gc`, log at `/var/log/nix-gc.log`), followed by a Homebrew
cache prune at 03:30.

## Layout

```
flake.nix            entry point; pins hostname/username/useremail
modules/             system level (nix-darwin)
  nix-core.nix       nixpkgs settings, scheduled GC
  system.nix         macOS defaults: Dock, Finder, keyboard, trackpad, ...
  packages.nix       system CLI tools and fonts from nixpkgs
  homebrew.nix       Homebrew brews and casks (cleanup = "zap")
  host-users.nix     hostname and user account
home/                user level (home-manager)
  default.nix        imports the modules below
  shell.nix          zsh, aliases, claude-* wrappers
  core.nix           direnv, nix-index, zoxide, eza, yazi, tmux
  fzf-bat.nix        fzf and bat
  git.nix, gh.nix    git (gitalias) and GitHub CLI (awesome-gh-aliases)
  starship.nix       prompt
  node.nix           Node, pnpm/corepack, npm-installed CLIs
  neovim.nix         Neovim; its kickstart-based config lives in home/nvim/
scripts/             install-rosetta / uninstall-rosetta
```

Rule of thumb: a tool with a home-manager `programs.*` module is configured in
`home/`; plain packages go in `modules/packages.nix`; GUI apps and anything
missing from nixpkgs go in `modules/homebrew.nix`.

## Git Aliases (Gitalias)

This configuration includes [gitalias](https://github.com/ruchirajkarki/gitalias) - a collection of 170+ mnemonic git aliases derived from command names. The aliases follow a pattern where short sequences represent full git commands.

### Complete Git Aliases Reference

**add** (5 aliases)
- `a` = add
- `aa` = add --all
- `ai` = add --interactive
- `ap` = add --patch
- `au` = add --update

**branch** (15 aliases)
- `b` = branch
- `ba` = branch --all
- `bav` = branch --all --verbose
- `bavv` = branch --all -vv
- `bc` = branch --copy
- `bd` = branch --delete
- `bdd` = branch -D
- `bdf` = branch --delete --force
- `bm` = branch --move
- `bmm` = branch -M
- `br` = branch --remotes
- `brv` = branch --remotes --verbose
- `buu` = branch --unset-upstream
- `bv` = branch --verbose
- `bvv` = branch -vv

**commit** (4 aliases)
- `c` = commit
- `ca` = commit --all
- `cam` = commit --all --message
- `cm` = commit --message

**diff** (6 aliases)
- `d` = diff
- `dc` = diff --cached
- `dfi` = diff --full-index
- `dno` = diff --name-only
- `dns` = diff --name-status
- `ds` = diff --stat

**rebase** (7 aliases)
- `e` = rebase
- `ea` = rebase --abort
- `ec` = rebase --continue
- `ei` = rebase --interactive
- `em` = rebase main
- `eo` = rebase --onto
- `es` = rebase --skip

**fetch** (3 aliases)
- `f` = fetch
- `fa` = fetch --all
- `ft` = fetch --tags

**log** (12 aliases)
- `g` = log
- `ga` = log --all
- `gag` = log --all --grep
- `gf` = log --follow
- `gg` = log --grep
- `gmc` = log --max-count
- `go` = log --oneline
- `gop` = log --oneline --patch
- `gopmc` = log --oneline --patch --max-count
- `gp` = log --patch
- `gpmc` = log --patch --max-count
- `gs` = log --stat

**stash** (7 aliases)
- `h` = stash
- `ha` = stash apply
- `hc` = stash clear
- `hd` = stash drop
- `hl` = stash list
- `hp` = stash pop
- `hs` = stash show

**config** (6 aliases)
- `i` = config
- `ie` = config --edit
- `ig` = config --global
- `ieg` = config --edit --global
- `il` = config --list
- `is` = config --system

**clone** (4 aliases)
- `k` = clone
- `kb` = clone --branch
- `kd` = clone --depth
- `krs` = clone --recurse-submodules

**pull** (8 aliases)
- `l` = pull
- `la` = pull --all
- `ld` = pull --depth
- `ldr` = pull --dry-run
- `lnt` = pull --no-tags
- `lp` = pull --prune
- `lq` = pull --quiet
- `lr` = pull --rebase
- `lv` = pull --verbose

**merge** (7 aliases)
- `m` = merge
- `ma` = merge --abort
- `mc` = merge --continue
- `mm` = merge main
- `mnc` = merge --no-commit
- `mncs` = merge --no-commit --squash
- `ms` = merge --squash

**clean** (10 aliases)
- `n` = clean
- `ndr` = clean --dry-run
- `nddr` = clean -d --dry-run
- `ndf` = clean -d --force
- `nf` = clean --force
- `nfdr` = clean --force --dry-run
- `ni` = clean --interactive
- `nq` = clean --quiet
- `nx` = clean -x
- `nxdr` = clean -x --dry-run

**remote** (7 aliases)
- `o` = remote
- `ov` = remote --verbose
- `oa` = remote add
- `oao` = remote add origin
- `opo` = remote prune origin
- `opodr` = remote prune origin --dry-run
- `osh` = remote set-head

**push** (11 aliases)
- `p` = push
- `pa` = push --all
- `pasuo` = push --all --set-upstream origin
- `pd` = push --delete
- `pdo` = push --delete origin
- `pf` = push --force
- `pfwl` = push --force-with-lease
- `po` = push origin
- `pot` = push origin tag
- `psuo` = push --set-upstream origin
- `pt` = push --tags

**restore** (2 aliases)
- `r` = restore
- `rs` = restore --staged

**switch** (6 aliases)
- `s` = switch
- `sc` = switch --create
- `sdc` = switch --discard-changes
- `sf` = switch --force
- `sfc` = switch --force-create
- `sm` = switch main

**reset** (4 aliases)
- `t` = reset
- `th` = reset --hard
- `tm` = reset --mixed
- `ts` = reset --soft

**status** (4 aliases)
- `u` = status
- `uss` = status --show-stash
- `uuf` = status --untracked-files
- `uv` = status --verbose

**revert** (6 aliases)
- `v` = revert
- `va` = revert --abort
- `vc` = revert --continue
- `vnc` = revert --no-commit
- `vq` = revert --quit
- `vs` = revert --skip

**cherry-pick** (2 aliases)
- `y` = cherry-pick
- `ync` = cherry-pick --no-commit

**Custom Aliases** (5 aliases)
- `ls` = log --pretty=format:"%C(yellow)%h%Cred%d\ %Creset%s%Cblue\ [%cn]" --decorate
- `ll` = log --pretty=format:"%C(yellow)%h%Cred%d\ %Creset%s%Cblue\ [%cn]" --decorate --numstat
- `amend` = commit --amend -m
- `update` = submodule update --init --recursive
- `foreach` = submodule foreach

## GitHub CLI Aliases (awesome-gh-aliases)

This configuration includes [awesome-gh-aliases](https://github.com/yashbhutwala/awesome-gh-aliases) - useful aliases and API scripts for the GitHub CLI (`gh`).

### Complete GitHub CLI Aliases Reference

**PR Operations**
- `gh pv` = pr view

**Issue Operations**
- `gh bugs` = issue list --label="bugs"
- `gh epicsBy <AUTHOR>` = issue list --author="$1" --label="epic"
- `gh igrep <LABEL> <SEARCH>` = !gh issue list --label="$1" | grep -i $2

**User Information**
- `gh user` = api user (fetch authenticated user info as JSON)

**Advanced GraphQL Queries**

- **`gh list-milestones`** - List open milestones for current repository (with pagination)
  ```bash
  gh list-milestones
  ```
  Output: Tab-separated values of milestone number and title

- **`gh pr-files-changed <PR_NUM>`** - List files changed in a pull request (with pagination)
  ```bash
  gh pr-files-changed 42
  ```
  Output: Tab-separated values of file paths

- **`gh list-repos <USERNAME>`** - List repositories for a specific user (with pagination)
  ```bash
  gh list-repos octocat
  ```
  Output: Tab-separated values of repository names

- **`gh search-repos <COUNT> <QUERY>`** - Search repositories with star counts (with pagination)
  ```bash
  gh search-repos 10 "language:go stars:>1000"
  ```
  Output: Tab-separated values of repository name and star count

### Usage Examples

```bash
# View current PR
gh pv

# List all issues labeled as bugs
gh bugs

# List issues for a specific author with epic label
gh epicsBy octocat

# Search for issues with a specific label
gh igrep "feature-request" "authentication"

# Get authenticated user info
gh user

# List milestones in current repo
gh list-milestones

# See what changed in PR #42
gh pr-files-changed 42

# List all repositories for a user
gh list-repos octocat

# Search for Go repositories with over 1000 stars
gh search-repos 10 "language:go stars:>1000"
```

For implementation details, check [home/gh.nix](home/gh.nix).
