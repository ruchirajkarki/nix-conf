{
  pkgs,
  # kickstart-nvim,
  ...
}: {
  home.packages = with pkgs; [
    # archives
    zip # compression utility
    xz # compression utility
    unzip # decompression utility
    p7zip # compression utility for 7-Zip archives

    # utils
    ripgrep # recursively searches directories for a regex pattern
    jq # A lightweight and flexible command-line JSON processor
    yq-go # yaml processer https://github.com/mikefarah/yq
    fzf # A command-line fuzzy finder

    aria2 # A lightweight multi-protocol & multi-source command-line download utility
    socat # replacement of openbsd-netcat
    nmap # A utility for network discovery and security auditing

    # misc
    cowsay # displays ASCII cows with a message
    file # determines file type
    which # locates a command
    tree # lists directory contents in a tree-like format
    gnused # GNU stream editor
    gnutar # GNU version of the tar archiving utility
    gawk # GNU implementation of AWK
    zstd # fast lossless compression algorithm
    caddy # powerful, enterprise-ready open source web server
    gnupg # tool for secure communication
    # productivity
    glow # markdown previewer in terminal
    zoxide # fast directory jumper

    # terminal multiplexer for managing terminal sessions
    tmux

    # Next.js dev helpers
    # watchman # file watching service developed by Facebook
    # eslint_d # daemon version of ESLint for faster linting
    # mkcert # simple tool for creating locally trusted development certificates
  ];

  programs = {
    # direnv + nix-direnv: auto-load .envrc and Nix shells
    direnv = {
      enable = true;
      nix-direnv.enable = true;
    };

    # nix-index: find which package provides a command (with Zsh integration)
    nix-index = {
      enable = true;
      enableZshIntegration = true;
    };
    # zoxide: smarter cd command
    zoxide = {
      enable = true;
      enableZshIntegration = true;
    };
    # modern vim
    neovim = {
      enable = true;
      defaultEditor = true;
      vimAlias = true;
    };

    # A modern replacement for ‘ls’
    # useful in bash/zsh prompt, not in nushell.
    eza = {
      enable = true;
      git = true;
      icons = "auto";
      enableZshIntegration = true;
    };

    # terminal file manager
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

    # skim provides a single executable: sk.
    # Basically anywhere you would want to use grep, try sk instead.
    skim = {
      enable = true;
      enableBashIntegration = true;
    };

    # tmux configuration
    tmux = {
      enable = true;
      # Basic tmux configuration for developers
      extraConfig = ''
        set -g mouse on
        bind r source-file ~/.tmux.conf \; display-message "Config reloaded!"
        setw -g mode-keys vi
      '';
    };

    # vscode = {
    #enable = false; // We are installing with brew
    #  # extensions = with pkgs.vscode-extensions; [
    #  #  esbenp.prettier-vscode
    #  #  dbaeumer.vscode-eslint
    #  #  eamodio.gitlens
    #  #  mhutchie.git-graph
    #  #  streetsidesoftware.code-spell-checker
    #  # ];
    #};
  };

  # Link your fork of kickstart.nvim as the Neovim config
  xdg = {
    enable = true;
    # configFile."nvim" = {
    #   source = kickstart-nvim;
    #   recursive = true;
    # };
  };
}
