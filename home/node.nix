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
    "${dataHome}/browse/bin"
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

  # Install the Browserbase browse CLI globally
  home.activation."install-browse" = lib.hm.dag.entryAfter ["writeBoundary"] ''
    mkdir -p ${dataHome}/browse
    PATH="${nodejs}/bin:$PATH" ${nodejs}/bin/npm install -g --prefix ${dataHome}/browse browse@latest
  '';

  # Install Playwright MCP and register it with Claude Code (user scope) as a
  # headless browser driving the Homebrew Google Chrome. ~/.claude.json is
  # mutable app state, so it's registered via the CLI rather than a managed file.
  home.activation."install-playwright-mcp" = lib.hm.dag.entryAfter ["writeBoundary"] ''
    mkdir -p ${dataHome}/playwright-mcp ${config.xdg.cacheHome}/playwright-claude
    PATH="${nodejs}/bin:$PATH" ${nodejs}/bin/npm install -g --prefix ${dataHome}/playwright-mcp @playwright/mcp@latest
    if [[ -x /opt/homebrew/bin/claude ]]; then
      /opt/homebrew/bin/claude mcp remove -s user playwright >/dev/null 2>&1 || true
      /opt/homebrew/bin/claude mcp add -s user playwright -- \
        ${nodejs}/bin/node ${dataHome}/playwright-mcp/lib/node_modules/@playwright/mcp/cli.js \
        --headless --browser chrome \
        --user-data-dir ${config.xdg.cacheHome}/playwright-claude
    fi
  '';
}
