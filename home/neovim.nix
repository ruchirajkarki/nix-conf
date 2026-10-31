{pkgs, ...}: {
  programs.neovim = {
    enable = true;
    defaultEditor = true;
    viAlias = true;
    vimAlias = true;
    withRuby = false;
    withPython3 = false;

    # Extra packages available in Neovim's PATH
    extraPackages = with pkgs; [
      gcc
      # JavaScript / TypeScript
      prettier
      eslint_d
      typescript
      typescript-language-server
    ];
  };

  # kickstart-based config, see ./nvim. Linked file-by-file so plugin
  # managers can still write lockfiles next to it.
  xdg.configFile."nvim" = {
    source = ./nvim;
    recursive = true;
  };
}
