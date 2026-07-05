{
  pkgs,
  config,
  lib,
  ...
}: {
  programs.zsh = {
    enable = true;
    enableCompletion = true;
    defaultKeymap = "viins";
    envExtra = ''
      # Clean stale Homebrew completions before any global compinit runs
      if [[ ! -e /opt/homebrew/completions/zsh/_brew ]]; then
        [[ -L /opt/homebrew/share/zsh/site-functions/_brew ]] && rm -f /opt/homebrew/share/zsh/site-functions/_brew
        fpath=(''${fpath:#/opt/homebrew/share/zsh/site-functions})
        zcompdump="''${ZDOTDIR:-$HOME}/.zcompdump"
        if [[ -e "$zcompdump" ]] && grep -q "/opt/homebrew/share/zsh/site-functions/_brew" "$zcompdump"; then
          rm -f "$zcompdump" "$zcompdump".zwc
        fi
      fi
    '';
    autosuggestion = {
      enable = true;
    };
    syntaxHighlighting = {
      enable = true;
    };
    dotDir = "${config.xdg.configHome}/zsh";

    history = {
      size = 10000;
      save = 10000;
      path = "$HOME/.local/state/zsh/history";
      share = true;
      expireDuplicatesFirst = true;
    };

    setOptions = [
      "AUTO_CD"
      "INTERACTIVE_COMMENTS"
      "EXTENDED_GLOB"
      "HIST_IGNORE_DUPS"
      "HIST_VERIFY"
    ];

    plugins = [
      {
        name = "fzf-tab";
        src = pkgs.zsh-fzf-tab;
        file = "share/fzf-tab/fzf-tab.plugin.zsh";
      }
      {
        name = "zsh-vi-mode";
        src = pkgs.zsh-vi-mode;
        file = "share/zsh-vi-mode/zsh-vi-mode.plugin.zsh";
      }
      {
        name = "zsh-autopair";
        src = pkgs.zsh-autopair;
        file = "share/zsh-autopair/autopair.zsh";
      }
    ];
    initContent = lib.mkMerge [
      (lib.mkOrder 550 ''
        # Homebrew setup (macOS) - runs before completion init
        if [[ -f /opt/homebrew/bin/brew ]]; then
          eval "$(/opt/homebrew/bin/brew shellenv)"
        fi
      '')
      ''
          # General paths
          export PATH="$PATH:$HOME/bin:$HOME/.local/bin:$HOME/go/bin"

        # Java (Homebrew OpenJDK)
        export PATH="/opt/homebrew/opt/openjdk@21/bin:$PATH"
        export CPPFLAGS="-I/opt/homebrew/opt/openjdk@21/include"

        # Android SDK
        export ANDROID_HOME="$HOME/Library/Android/sdk"
        export PATH="$PATH:$ANDROID_HOME/platform-tools"
        export PATH="$PATH:$ANDROID_HOME/tools/bin"
        export PATH="$PATH:$ANDROID_HOME/emulator"

        export PATH=/Users/ruchirajkarki/.mimocode/bin:$PATH

        # fzf previews and nicer defaults
        export FZF_DEFAULT_OPTS="--height=40% --layout=reverse --border"
        export FZF_CTRL_T_OPTS='--preview "bat --style=numbers --color=always {} | head -500"'
        export FZF_ALT_C_OPTS='--preview "eza -lah --group-directories-first --icons {} | head -200"'

        # Autosuggestions: async + history strategy; use array-safe assignments
        typeset -ga ZSH_AUTOSUGGEST_STRATEGY
        ZSH_AUTOSUGGEST_STRATEGY=(history)
        typeset -g ZSH_AUTOSUGGEST_USE_ASYNC=1
        typeset -g ZSH_AUTOSUGGEST_BUFFER_MAX_SIZE=50
        if typeset -f autosuggest-accept >/dev/null; then
          bindkey -M viins '^f' autosuggest-accept
        fi

        # Vi-mode ergonomics: jk to escape; cursors per mode
        export KEYTIMEOUT=20
        function zle-keymap-select {
          if [[ $KEYMAP == vicmd ]]; then
            print -n '\e[1 q'   # block cursor
          else
            print -n '\e[5 q'   # beam cursor
          fi
        }
        function zle-line-init { zle -K viins; print -n '\e[5 q'; }
        zle -N zle-keymap-select
        zle -N zle-line-init
        bindkey -M viins 'jk' vi-cmd-mode
      ''
    ];
  };

  home.shellAliases = {
    t = "turbo";
    dd = "cd ~/nix-conf && make deploy";
    cto = "${config.home.homeDirectory}/.local/share/cto/bin/cto";

    # pnpm dev aliases
    pi = "pnpm install";
    pd = "pnpm dev";
    pb = "pnpm build";
    pl = "pnpm lint";
    pt = "pnpm test";

    lg = "lazygit";

    urldecode = "python3 -c 'import sys, urllib.parse as ul; print(ul.unquote_plus(sys.stdin.read()))'";
    urlencode = "python3 -c 'import sys, urllib.parse as ul; print(ul.quote_plus(sys.stdin.read()))'";

    # Git aliases
    gs = "git stash";
    gc = "git checkout";
    gpl = "git pull";
    gps = "git push";
    gcmsg = "git commit -m";
    gbr = "git branch";
    gdf = "git diff";
    gplr = "git pull --rebase";
    gcm = "git checkout main";
    gcd = "git checkout dev";
    gct = "git checkout testing";
    gcs = "git checkout staging";
    gcb = "git checkout -b";

    # Github CLI aliases
    pr-create = "gh pr create --fill-verbose --editor --base";
    pr-merge = "gh pr merge --squash --delete-branch";

    # Docker aliases
    dcu = "docker-compose up";
    dcd = "docker-compose down";
    dcb = "docker-compose build";
    dcl = "docker-compose logs";
  };
}
