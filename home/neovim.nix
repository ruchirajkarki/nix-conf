{
  pkgs,
  ...
}: {
  # Neovim with kickstart-based config
  programs.neovim = {
    enable = true;
    defaultEditor = true;
    viAlias = true;
    vimAlias = true;

    # Extra packages available in Neovim's PATH
    extraPackages = with pkgs; [
      ripgrep
      fd
      tree-sitter
      gcc
      # JavaScript / TypeScript
      prettier
      eslint_d
      typescript
      typescript-language-server
    ];
  };

  # Our custom Neovim config - fully managed by nix
  xdg.configFile = {
    "nvim/init.lua".source = ../lua/init.lua;
    "nvim/lua/custom" = {
      source = ../lua/custom;
      recursive = true;
    };
    "nvim/lua/kickstart" = {
      source = ../lua/kickstart;
      recursive = true;
    };
  };
}
