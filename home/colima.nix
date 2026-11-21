{
  username,
  pkgs,
  ...
}: {
  # Docker on macOS means a Linux VM. Colima provides that VM headlessly, so no
  # Docker Desktop licence is needed; the CLI tools (docker, compose, buildx)
  # live in modules/packages.nix.
  #
  # `--foreground` keeps the VM tied to this launchd-supervised process, which
  # is what makes it start at login and restart after a crash. Lima also runs
  # its own hostagent, so if the agent attaches to an already-running Colima it
  # exits 0 ("already running, ignoring") and the VM simply keeps going.
  launchd.agents.colima = {
    enable = true;
    config = {
      Label = "com.ruchirajkarki.colima";
      ProgramArguments = [
        "${pkgs.colima}/bin/colima"
        "start"
        "--foreground"
        "--cpu"
        "4"
        "--memory"
        "6"
      ];
      RunAtLoad = true;
      # Restart after a crash but not after a clean exit, so `colima stop`
      # stays stopped until the next login.
      KeepAlive = {
        SuccessfulExit = false;
      };
      ThrottleInterval = 30;
      ProcessType = "Background";
      WorkingDirectory = "/Users/${username}";
      # launchd starts agents with a minimal environment; Colima shells out to
      # ssh and its bundled Lima binaries.
      EnvironmentVariables = {
        PATH = "${pkgs.colima}/bin:/run/current-system/sw/bin:/usr/bin:/bin:/usr/sbin:/sbin";
        HOME = "/Users/${username}";
        # The interactive shell inherits this from home-manager's XDG setup.
        # Without it Colima falls back to ~/.colima in launchd's bare
        # environment and creates a second VM alongside the real one in
        # ~/.config/colima.
        XDG_CONFIG_HOME = "/Users/${username}/.config";
      };
      StandardOutPath = "/Users/${username}/Library/Logs/colima.log";
      StandardErrorPath = "/Users/${username}/Library/Logs/colima.err.log";
    };
  };
}
