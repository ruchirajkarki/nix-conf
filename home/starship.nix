{...}: {
  programs.starship = {
    # enables and configures Starship, a cross-shell prompt
    enable = true;

    enableBashIntegration = true;
    enableZshIntegration = true;
    enableNushellIntegration = true;

    settings = {
      character = {
        success_symbol = "[›](bold green)";
        error_symbol = "[›](bold red)";
      };
      aws = {symbol = "🅰 ";};
      # battery.display.threshold = 99;
      battery.display = [{threshold = 20;}];
      gcloud = {
        # do not show the account/project's info
        # to avoid the leak of sensitive information when sharing the terminal
        format = "on [$symbol$active(($region))]($style) ";
        symbol = "🅶 ️";
      };
      docker_context = {
        symbol = "🐳 ";
        disabled = false;
      };
    };
  };
}
