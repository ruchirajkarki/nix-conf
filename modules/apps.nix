{
  pkgs,
  ...
}: {
  environment.systemPackages = with pkgs; [
    git
    gh
    direnv
    jq
    fzf
    bat
    fd

    curl
    wget
    fastfetch
    killall
    tree
    nerd-fonts.hack
    roboto
    noto-fonts
    noto-fonts-cjk-sans
    noto-fonts-color-emoji
  ];
  environment.variables.EDITOR = "nvim";

  homebrew = {
    enable = true;

    onActivation = {
      autoUpdate = true;
      upgrade = true;
      cleanup = "zap";
    };

    masApps = {};

    taps = [];

    brews = [
      "wget"
      "curl"
      "biome"
      "go"
      "nvm"
      "spicetify-cli"
      "ffmpeg"
      "asciiquarium"
      "speedtest-cli"
      "yt-dlp"
      "gnupg"
      "git-extras"
      "btop"
    ];

    casks = [
      "opensuperwhisper"
      "openmtp"
      "xcodes-app"
      "firefox"
      "jan"
      "spotify"
      "copilot-cli"
      "localsend"
      "ghostty"
      "pearcleaner"
      "wezterm"
      "mac-mouse-fix"
      "ollama-app"
      "obsidian"
      "raindropio"
      "codex"
      "visual-studio-code"
      "dbeaver-community"
      "bruno"
      "iina"
      "raycast"
      "stats"
      "docker-desktop"
    ];
  };
}
