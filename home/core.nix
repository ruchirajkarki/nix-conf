{
  pkgs,
  ...
}: {
  home.packages = with pkgs; [
    # archives
    zip
    xz
    unzip
    p7zip

    # utils
    ripgrep
    yq-go

    aria2
    socat
    nmap

    # misc
    cowsay
    file
    which
    gnused
    gnutar
    gawk
    zstd
    caddy
    gnupg

    # productivity
    glow
    zoxide
    tmux
  ];

  programs = {
    direnv = {
      enable = true;
      nix-direnv.enable = true;
    };

    nix-index = {
      enable = true;
      enableZshIntegration = true;
    };

    zoxide = {
      enable = true;
      enableZshIntegration = true;
    };

    eza = {
      enable = true;
      git = true;
      icons = "auto";
      enableZshIntegration = true;
    };

    yazi = {
      enable = true;
      enableZshIntegration = true;
      shellWrapperName = "yy";
      settings = {
        manager = {
          show_hidden = true;
          sort_dir_first = true;
        };
      };
    };

    skim = {
      enable = true;
      enableBashIntegration = true;
    };

    tmux = {
      enable = true;
      extraConfig = ''
        set -g mouse on
        bind r source-file ~/.tmux.conf \; display-message "Config reloaded!"
        setw -g mode-keys vi
      '';
    };
  };

  xdg = {
    enable = true;
  };
}
