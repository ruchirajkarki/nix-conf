{pkgs, ...}: {
  environment.systemPackages = with pkgs; [
    git
    gh
    jq
    fd
    mutagen
    oci-cli
    ollama

    curl
    wget
    tree
    nerd-fonts.hack
    roboto
    noto-fonts
    noto-fonts-color-emoji

    (writeShellScriptBin "install-rosetta" (builtins.readFile ../scripts/install-rosetta.sh))
    (writeShellScriptBin "uninstall-rosetta" (builtins.readFile ../scripts/uninstall-rosetta.sh))
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
      "biome"
      "go"
      "ffmpeg"
      "speedtest-cli"
      "yt-dlp"
      "git-extras"
      "btop"
      "mistral-vibe"
      "vercel"
    ];

    casks = [
      "firefox"
      "google-chrome"
      "bitwarden"
      "claude"
      "claude-code"
      "localsend"
      "ghostty"
      "pearcleaner"
      "mac-mouse-fix"
      "obsidian"
      "raindropio"
      "visual-studio-code"
      "dbeaver-community"
      "bruno"
      "iina"
      "kde-connect"
      "raycast"
      "stats"
      "docker-desktop"
      "cloudflare-warp"
      "free-download-manager"
    ];
  };
}
