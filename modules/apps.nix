{
  pkgs,
  pkgs-turbo,
  ...
}: {
  ##########################################################################
  #
  #  Install all apps and packages here.
  #
  # TODO Fell free to modify this file to fit your needs.
  #
  ##########################################################################

  # Install packages from nix's official package repository.
  #
  # The packages installed here are available to all users, and are reproducible across machines, and are rollbackable.
  # But on macOS, it's less stable than homebrew.
  #
  # Related Discussion: https://discourse.nixos.org/t/darwin-again/29331
  environment.systemPackages = with pkgs; [
    neovim # modern, highly extensible text editor
    git # version control system
    lazygit # terminal-based UI for Git
    # just # use Justfile to simplify nix-darwin's commands
    # rar
    gh # GitHub CLI
    nodejs # JavaScript runtime
    nil # Language Server for Nix
    # yarn
    #nodejs_18
    #(yarn.override { nodejs = nodejs_18; })
    direnv # loads environment variables per directory
    # nix-direnv
    jq # command-line JSON processor
    ripgrep # fast search tool
    just # command runner
    fzf # command-line fuzzy finder
    bat # cat clone with syntax highlighting
    fd # find alternative
    nixfmt # formatter for Nix files
    gemini-cli # Gemini CLI
    # docker
    # docker-compose
    # For Expo
    nodePackages.eas-cli # command-line tool for Expo Application Services

    pkgs-turbo.turbo # Vercel TurboRepo CLI (pinned to working version)
    # tmux # terminal multiplexer for managing terminal sessions
    # postman
    # flutter
    # android-tools
    # codex # Outdated in nixpkgs (0.58.0), install via npm: npm install -g codex-cli
  ];
  environment.variables.EDITOR = "nvim";

  # TODO To make this work, homebrew need to be installed manually, see https://brew.sh
  #
  # The apps installed by homebrew are not managed by nix, and not reproducible!
  # But on macOS, homebrew has a much larger selection of apps than nixpkgs, especially for GUI apps!
  homebrew = {
    enable = true;

    onActivation = {
      autoUpdate = true; # Fetch the newest stable branch of Homebrew's git repo
      upgrade = true; # Upgrade outdated casks, formulae, and App Store apps
      # 'zap': uninstalls all formulae(and related files) not listed in the generated Brewfile
      cleanup = "zap";
    };

    # Applications to install from Mac App Store using mas.
    # You need to install all these Apps manually first so that your apple account have records for them.
    # otherwise Apple Store will refuse to install them.
    # For details, see https://github.com/mas-cli/mas
    masApps = {
      # TODO Feel free to add your favorite apps here.
      # "DevCleaner for Xcode" = 1388020431; # Xcode cache cleaner
      "uBlock origin lite" = 6745342698; # content blocker

      # Xcode = 497799835;
      # Wechat = 836500024;
      # NeteaseCloudMusic = 944848654;
      # QQ = 451108668;
      # WeCom = 1189898970;  # Wechat for Work
      # TecentMetting = 1484048379;
      # QQMusic = 595615424;
    };

    taps = [
      "hashicorp/tap"
      # "homebrew/services"
    ];

    # `brew install`
    # TODO Feel free to add your favorite apps here.
    brews = [
      "wget" # tool for downloading files
      "curl" # tool for transferring data with URLs
      "biome" # toolchain for web development
      # "aria2" # download tool
      # "httpie" # http client
      "cloudflared" # command-line tool for Cloudflare Tunnel
      # "mariadb"
      # "php"
      # "composer"
      # "go"
      # "fastlane"
      # "minikube"
      # "skaffold"
      # "rbenv"
      "libpq" # C application programmer's interface to PostgreSQL
      "shellcheck" # shell script static analysis tool
      "openjdk@21" # Java Development Kit
      "spicetify-cli" # command-line tool to customize Spotify
      # "container"
      # "spicetify-cli" # Spotify customizer
      # "scrcpy"
      # "cocoapods" # CocoaPods CLI for iOS development

      ##### FOR DOPPLER ######
      # Prerequisite. gnupg is required for binary signature verification
      "gnupg" # tool for secure communication
      # Next, install using brew (use `doppler update` for subsequent updates)
      "dopplerhq/cli/doppler" # command-line interface for the Doppler platform
      ########################
      "git-extras"
      "hashicorp/tap/vault" # HashiCorp Vault CLI
    ];

    # `brew install --cask`
    # TODO Feel free to add your favorite apps here.
    casks = [
      "openmtp" # Android file transfer app for macOS

      # "xcodes"
      "firefox" # web browser
      "spotify" # music streaming service
      # "claude-code"
      "localsend" # sharing files between devices on a local network
      "google-chrome" # web browser
      "ghostty" # fast, feature-rich, and cross-platform terminal emulator
      "appcleaner" # utility to thoroughly uninstall applications on macOS
      "pearcleaner" # likely a cleaning utility for macOS
      # "cloudflare-warp"
      # "cursor"
      "mac-mouse-fix" # likely a utility for customizing or fixing mouse behavior on macOS
      # "android-studio"
      # "reactotron"
      # "ollama-app"
      # "expo-orbit"
      "obsidian" # markdown-based knowledge base and note-taking application
      "cursor" # AI-first code editor
      "codex" # OpenAI Codex CLI
      # "rar"
      # "visual-studio-code"
      # "utm"
      # "arc"
      # "sublime-text"
      "dbeaver-community" # free multi-platform database tool
      # IM & audio & remote desktop & meeting
      # "telegram"
      # "discord"
      "brainfm" # service that provides functional music to improve focus, relaxation, and sleep

      # "anki"
      "iina" # modern media player for macOS
      "raycast" # (HotKey: alt/option + space)search, caculate and run scripts(with many plugins)
      "stats" # free, open-source macOS app that monitors various system statistics
      # "eudic" # 欧路词典
      "tower"

      # Development
      # "insomnia" # REST client
      # "postman"
      # "wireshark" # network analyzer
      # "soulseek"
      "docker-desktop" # desktop application for running Docker
      "visual-studio-code@insiders" # insiders build; signed build; nix package fails codesign on macOS
    ];
  };
}
