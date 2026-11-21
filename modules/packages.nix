{pkgs, ...}: {
  # System-wide CLI tools from nixpkgs. Tools configured through a
  # home-manager `programs.*` module (git, gh, fzf, bat, ...) live in home/.
  environment.systemPackages = with pkgs; [
    # basics
    curl
    wget
    tree
    jq
    yq-go
    ripgrep
    fd
    xz
    zstd

    # GNU variants, deliberately shadowing the BSD tools macOS ships
    gnused
    gnutar
    gawk
    gnupg

    # containers
    colima
    docker-client
    docker-compose
    docker-buildx

    # android - adb, fastboot
    android-tools

    # cloud / AI
    oci-cli
    codex # OpenAI Codex CLI (freebuff is npm-only, see home/node.nix)
    gemini-cli
    google-cloud-sdk
    gws
    uv # runs MCP servers via uvx (e.g. mcp-for-blender)

    (writeShellScriptBin "install-rosetta" (builtins.readFile ../scripts/install-rosetta.sh))
    (writeShellScriptBin "uninstall-rosetta" (builtins.readFile ../scripts/uninstall-rosetta.sh))
  ];

  fonts.packages = with pkgs; [
    nerd-fonts.hack
    nerd-fonts.jetbrains-mono
    nerd-fonts.fira-code
    nerd-fonts.symbols-only
  ];
}
