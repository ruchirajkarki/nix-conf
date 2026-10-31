{username, ...}: let
  nixGc = "/nix/var/nix/profiles/default/bin/nix-collect-garbage";
  nix = "/nix/var/nix/profiles/default/bin/nix";
in {
  # Nix itself is installed and managed by Determinate Nix (determinate-nixd),
  # so nix-darwin must not manage the daemon. This also means `nix.settings`,
  # `nix.gc` and `nix.optimise` are unavailable: settings go in
  # /etc/nix/nix.custom.conf, and GC is scheduled below via launchd instead.
  nix.enable = false;

  nixpkgs.config.allowUnfree = true;

  # Weekly (Sunday 03:00): drop system generations older than 14 days, GC the
  # store, then hard-link identical files. `nix store optimise` is the safe
  # periodic alternative to auto-optimise-store (NixOS/nix#7273).
  launchd.daemons.nix-gc = {
    script = ''
      ${nixGc} --delete-older-than 14d
      ${nix} store optimise
    '';
    serviceConfig = {
      StartCalendarInterval = [
        {
          Weekday = 0;
          Hour = 3;
          Minute = 0;
        }
      ];
      StandardOutPath = "/var/log/nix-gc.log";
      StandardErrorPath = "/var/log/nix-gc.log";
    };
  };

  # Weekly: prune Homebrew's download cache (~/Library/Caches/Homebrew).
  launchd.user.agents.brew-cleanup = {
    command = "/opt/homebrew/bin/brew cleanup --prune=7";
    serviceConfig = {
      StartCalendarInterval = [
        {
          Weekday = 0;
          Hour = 3;
          Minute = 30;
        }
      ];
      StandardOutPath = "/Users/${username}/Library/Logs/brew-cleanup.log";
      StandardErrorPath = "/Users/${username}/Library/Logs/brew-cleanup.log";
    };
  };
}
