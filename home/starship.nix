{...}: {
  programs.starship = {
    enable = true;

    enableZshIntegration = true;

    settings = {
      character = {
        success_symbol = "[›](bold green)";
        error_symbol = "[›](bold red)";
      };
      aws = {symbol = "🅰 ";};
      battery.display = [{threshold = 20;}];
      gcloud = {
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
