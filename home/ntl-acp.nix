{
  config,
  pkgs,
  lib,
  ...
}: let
  nodejs = pkgs.nodejs_22;
  defaultVault = "${config.home.homeDirectory}/Documents/second-brain";
in {
  # Launcher that T3 Code runs as a local ACP agent command. The absolute path
  # is used because GUI apps do not inherit the shell PATH.
  # Canonical source lives in the cross-platform second-brain vault so Mac and
  # other platforms stay in sync; edits in the vault take effect immediately
  # without rebuilding nix-darwin.
  home.file.".local/bin/ntl-acp" = {
    executable = true;
    text = ''
      #!/bin/sh
      VAULT="''${OBSIDIAN_VAULT_PATH:-${defaultVault}}"
      exec ${lib.getExe nodejs} "$VAULT/Tools/ntl-acp/files/adapter.mjs" "$@"
    '';
  };
}
