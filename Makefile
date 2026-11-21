HOST  := Ruchis-MacBook-Air
FLAKE := .\#$(HOST)
NIX   := nix --extra-experimental-features 'nix-command flakes'
SYSTEM_PROFILE := /nix/var/nix/profiles/system
NIX_ENV := /nix/var/nix/profiles/default/bin/nix-env

.PHONY: deploy build check dry-run fmt update gc

# Build as the normal user, then only hand root the already-built ./result to
# activate. Deliberately no `nix` evaluation as root: the repo is owned by
# $(USER), and Nix's git fetcher refuses to open a repo owned by another uid
# ("repository path ... is not owned by current user"), while root also has its
# own Nix caches. `darwin-rebuild switch` would do that evaluation as root.
deploy: build ## build and switch
	sudo -H $(NIX_ENV) -p $(SYSTEM_PROFILE) --set ./result
	sudo ./result/sw/bin/darwin-rebuild activate

build: ## build without switching
	$(NIX) build .#darwinConfigurations.$(HOST).system

check: ## evaluate the flake
	$(NIX) flake check

dry-run: build ## show what a switch would change
	$(NIX) store diff-closures /run/current-system ./result

fmt: ## format nix files
	$(NIX) fmt .

update: ## bump flake inputs
	$(NIX) flake update

gc: ## delete generations older than 14 days, GC and optimise the store now
	sudo nix-collect-garbage --delete-older-than 14d
	nix store optimise
