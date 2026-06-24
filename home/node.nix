{
  pkgs,
  lib,
  config,
  ...
}: let
  inherit (config.xdg) dataHome;
  inherit (config.home) homeDirectory profileDirectory;

  nodejs = pkgs.nodejs_22;
  pnpmHome = "${dataHome}/pnpm";
  corepackHome = "${dataHome}/corepack";
  localBin = "${homeDirectory}/.local/bin";
  ctoPackages = "${dataHome}/cto-packages";
in {
  home.packages = [
    nodejs # JavaScript runtime
  ];

  home.sessionVariables = {
    PNPM_HOME = pnpmHome;
    COREPACK_HOME = corepackHome;
  };

  home.sessionPath = [
    "${profileDirectory}/bin"
    localBin
    pnpmHome
    "${dataHome}/cto/bin"
  ];

  # Ensure Corepack shims are installed once during activation so `pnpm`
  # resolves the version pinned in project packageManager fields.
  home.activation."corepack-enable-pnpm" = lib.hm.dag.entryAfter ["writeBoundary"] ''
    mkdir -p ${pnpmHome} ${corepackHome} ${localBin}
    COREPACK_HOME=${corepackHome} ${nodejs}/bin/corepack enable pnpm \
      --install-directory ${localBin} >/dev/null 2>&1 || true
  '';

  # Install claude-token-optimizer globally for cto alias
  home.activation."install-cto" = lib.hm.dag.entryAfter ["writeBoundary"] ''
    mkdir -p ${dataHome}/cto
    if [[ ! -d ${dataHome}/cto/lib/node_modules/claude-token-optimizer ]]; then
      ${nodejs}/bin/npm install -g --prefix ${dataHome}/cto claude-token-optimizer
    fi
  '';
}
