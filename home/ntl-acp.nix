{
  pkgs,
  lib,
  ...
}: let
  nodejs = pkgs.nodejs_22;
  adapter = ./ntl-acp/adapter.mjs;
in {
  # Launcher that T3 Code runs as a local ACP agent command. The absolute path
  # is used because GUI apps do not inherit the shell PATH.
  home.file.".local/bin/ntl-acp" = {
    executable = true;
    text = ''
      #!/bin/sh
      exec ${lib.getExe nodejs} ${adapter} "$@"
    '';
  };
}
