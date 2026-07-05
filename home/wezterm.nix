{...}: {
  # symlink the wezterm config from files/.config into place
  home.file.".config/wezterm/wezterm.lua".source = ../files/.config/wezterm/wezterm.lua;
}
