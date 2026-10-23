{
  description = "Nix for macOS configuration";

  nixConfig = {
    substituters = [
      "https://cache.nixos.org"
    ];
  };

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

    home-manager = {
      url = "github:nix-community/home-manager/master";
      inputs.nixpkgs.follows = "nixpkgs";
    };

    darwin = {
      url = "github:lnl7/nix-darwin";
      inputs.nixpkgs.follows = "nixpkgs";
    };

    # nix-homebrew pins brew 6.0.12, which predates the `command_wrapper`
    # cask stanza used by casks like firefox. Override it with a release
    # that understands it.
    brew-src = {
      url = "github:Homebrew/brew/6.0.14";
      flake = false;
    };

    nix-homebrew = {
      url = "github:zhaofengli/nix-homebrew";
      inputs.brew-src.follows = "brew-src";
    };
  };

  outputs = inputs @ {
    nixpkgs,
    darwin,
    home-manager,
    nix-homebrew,
    ...
  }: let
    username = "ruchirajkarki";
    useremail = "ruchirajkarki@icloud.com";
    system = "aarch64-darwin";
    hostname = "Ruchis-MacBook-Air";

    specialArgs = inputs // {inherit username useremail hostname;};
  in {
    darwinConfigurations."${hostname}" = darwin.lib.darwinSystem {
      inherit system specialArgs;
      modules = [
        ./modules/nix-core.nix
        ./modules/system.nix
        ./modules/packages.nix
        ./modules/homebrew.nix
        ./modules/host-users.nix

        nix-homebrew.darwinModules.nix-homebrew

        home-manager.darwinModules.home-manager
        {
          home-manager = {
            useGlobalPkgs = true;
            useUserPackages = true;
            extraSpecialArgs = specialArgs;
            users.${username} = import ./home;
          };
        }
      ];
    };

    formatter.${system} = nixpkgs.legacyPackages.${system}.alejandra;
  };
}
