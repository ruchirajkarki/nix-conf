{...}: let
  fd = "fd --hidden --follow --exclude .git";
in {
  programs.fzf = {
    enable = true;
    enableZshIntegration = true;
    defaultCommand = "${fd} --type f";
    defaultOptions = ["--height=40%" "--layout=reverse" "--border"];
    fileWidget = {
      command = "${fd} --type f";
      options = ["--preview 'bat --style=numbers --color=always {} | head -500'"];
    };
    changeDirWidget = {
      command = "${fd} --type d";
      options = ["--preview 'eza -lah --group-directories-first --icons {} | head -200'"];
    };
  };

  programs.bat.enable = true;
}
