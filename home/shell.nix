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
      enable = true; # enables command autosuggestions
    };
    syntaxHighlighting = {
      enable = true; # enables syntax highlighting for the shell
    };
    "oh-my-zsh" = {
      enable = false;
      theme = "agnoster";
      plugins = [
        "git"
        "npm"
        "node"
        "yarn"
        "docker"
        "docker-compose"
        "kubectl"
        "helm"
      ];
    };
    # Prefer XDG layout for Zsh configs (silence deprecation warning)
    dotDir = "${config.xdg.configHome}/zsh";

    # Improve history behavior
    history = {
      size = 10000;
      save = 10000;
      path = "$HOME/.local/state/zsh/history";
      share = true;
      expireDuplicatesFirst = true;
    };

    # Helpful, low-risk Zsh options
    setOptions = [
      "AUTO_CD" # cd by typing directory name
      "INTERACTIVE_COMMENTS" # allow # comments in interactive shell
      "EXTENDED_GLOB" # richer globbing
      "HIST_IGNORE_DUPS" # ignore consecutive duplicates
      "HIST_VERIFY" # edit before executing from history
    ];

    # Lightweight plugins (non-OMZ)
    plugins = [
      {
        name = "fzf-tab"; # integrates fzf with Zsh's tab completion
        src = pkgs.zsh-fzf-tab;
        file = "share/fzf-tab/fzf-tab.plugin.zsh";
      }
      {
        name = "zsh-vi-mode"; # enables vi-like keybindings in Zsh
        src = pkgs.zsh-vi-mode;
        file = "share/zsh-vi-mode/zsh-vi-mode.plugin.zsh";
      }
      {
        name = "zsh-autopair"; # automatically inserts and deletes matching pairs of delimiters
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

        # Install NestJS CLI globally via pnpm if not already installed
        if command -v pnpm >/dev/null 2>&1 && ! command -v nest >/dev/null 2>&1; then
          pnpm add -g @nestjs/cli >/dev/null 2>&1 || true
        fi

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

    code = "code-insiders";

    # pnpm dev aliases
    pi = "pnpm install";
    pd = "pnpm dev";
    pb = "pnpm build";
    pl = "pnpm lint";
    pt = "pnpm test";

    lg = "lazygit";

    urldecode = "python3 -c 'import sys, urllib.parse as ul; print(ul.unquote_plus(sys.stdin.read()))'";
    urlencode = "python3 -c 'import sys, urllib.parse as ul; print(ul.quote_plus(sys.stdin.read()))'";

    # Additional development-friendly aliases
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

    # Kubernetes aliases
    k = "kubectl";
    kga = "kubectl get all";
    kgn = "kubectl get nodes";
    kgp = "kubectl get pods";
    kgs = "kubectl get services";
    kd = "kubectl describe";
    kl = "kubectl logs";
  };
}
