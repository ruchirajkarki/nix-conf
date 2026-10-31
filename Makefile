HOST  := Ruchis-MacBook-Air
FLAKE := .\#$(HOST)
NIX   := nix --extra-experimental-features 'nix-command flakes'

.PHONY: deploy build check dry-run fmt update gc

deploy: build ## build and switch
	sudo ./result/sw/bin/darwin-rebuild switch --flake $(FLAKE)

build: ## build without switching
	$(NIX) build .#darwinConfigurations.$(HOST).system

check: ## evaluate the flake
	$(NIX) flake check

dry-run: build ## show what a switch would change
	sudo ./result/sw/bin/darwin-rebuild switch --flake $(FLAKE) --dry-run

fmt: ## format nix files
	$(NIX) fmt .

update: ## bump flake inputs
	$(NIX) flake update

gc: ## delete generations older than 14 days, GC and optimise the store now
	sudo nix-collect-garbage --delete-older-than 14d
	nix store optimise
