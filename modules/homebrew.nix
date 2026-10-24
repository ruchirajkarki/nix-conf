{username, ...}: {
  # Manages the Homebrew installation itself.
  nix-homebrew = {
    enable = true;
    user = username;
    autoMigrate = true;
  };

  # Manages what Homebrew installs: GUI apps and anything not in nixpkgs.
  # cleanup = "zap" uninstalls (and wipes app data of) anything removed here.
  homebrew = {
    enable = true;

    onActivation = {
      autoUpdate = true;
      upgrade = true;
      cleanup = "zap";
    };

    taps = [];
    masApps = {};

    brews = [
      # dev
      "biome"
      "go"
      "vercel"
      "mistral-vibe"
      "bitwarden-cli"

      # media / system
      "ffmpeg"
      "yt-dlp"
      "btop"
    ];

    casks = [
      # browsers
      "firefox"
      "google-chrome"

      # dev
      "ghostty"
      "visual-studio-code"
      "claude"
      "claude-code@latest"

      # media
      "iina"

      # creative / game dev
      "blender"
      "unity"
      "unity-hub"

      # music production
      "fl-studio"

      # productivity
      "raycast"
      "obsidian"
      "raindropio"
      "bitwarden"

      # utilities
      "jordanbaird-ice"
      "pearcleaner"
      "localsend"
      "free-download-manager"
      "cloudflare-warp"

      # game dev: Godot plus the toolchain it needs for Android export
      "godot"
      "temurin@17"
      "android-commandlinetools"
    ];
  };
}
