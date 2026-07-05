{username, ...}: {
  imports = [
    ./shell.nix
    ./core.nix
    ./node.nix
    ./git.nix
    ./gh.nix
    ./starship.nix
    ./fzf-bat.nix
    ./wezterm.nix
    ./neovim.nix
  ];

  home = {
    username = username;
    homeDirectory = "/Users/${username}";
    stateVersion = "25.05";
  };

  programs.home-manager.enable = true;
}
