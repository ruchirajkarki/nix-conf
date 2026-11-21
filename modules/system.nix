{
  pkgs,
  username,
  ...
}: {
  system = {
    stateVersion = 5;
    primaryUser = username;

    defaults = {
      dock = {
        autohide = true;
        autohide-delay = 0.0;
        autohide-time-modifier = 0.15;
        show-recents = false;
        orientation = "right";
        static-only = true;
        tilesize = 24;
        magnification = true;
        minimize-to-application = true;
        # Keep Spaces in a fixed order instead of reshuffling by recent use.
        mru-spaces = false;

        # Hot corners: 1 = disabled
        wvous-tl-corner = 1;
        wvous-tr-corner = 1;
        wvous-bl-corner = 1;
        wvous-br-corner = 1;
      };

      finder = {
        _FXShowPosixPathInTitle = true;
        _FXSortFoldersFirst = true;
        AppleShowAllExtensions = true;
        AppleShowAllFiles = true;
        FXDefaultSearchScope = "SCcf"; # search the current folder
        FXEnableExtensionChangeWarning = false;
        FXPreferredViewStyle = "Nlsv"; # list view
        FXRemoveOldTrashItems = true; # empty Trash items after 30 days
        NewWindowTarget = "Home";
        QuitMenuItem = true;
        ShowPathbar = true;
        ShowStatusBar = true;
        ShowExternalHardDrivesOnDesktop = true;
        ShowHardDrivesOnDesktop = true;
        ShowMountedServersOnDesktop = true;
        ShowRemovableMediaOnDesktop = true;
      };

      trackpad = {
        Clicking = true;
        TrackpadRightClick = true;
        TrackpadThreeFingerDrag = true;
      };

      NSGlobalDomain = {
        "com.apple.swipescrolldirection" = true;
        "com.apple.sound.beep.feedback" = 0;
        AppleInterfaceStyle = "Dark";
        AppleKeyboardUIMode = 3;
        ApplePressAndHoldEnabled = false;
        InitialKeyRepeat = 15;
        KeyRepeat = 3;
        NSAutomaticCapitalizationEnabled = false;
        NSAutomaticDashSubstitutionEnabled = false;
        NSAutomaticPeriodSubstitutionEnabled = false;
        NSAutomaticQuoteSubstitutionEnabled = false;
        NSAutomaticSpellingCorrectionEnabled = false;
        NSAutomaticWindowAnimationsEnabled = false;
        NSDocumentSaveNewDocumentsToCloud = false;
        NSNavPanelExpandedStateForSaveMode = true;
        NSNavPanelExpandedStateForSaveMode2 = true;
        # Ctrl+Cmd+drag anywhere on a window to move it.
        NSWindowShouldDragOnGesture = true;
      };

      controlcenter.BatteryShowPercentage = true;

      screencapture = {
        location = "~/Desktop";
        type = "png";
        disable-shadow = true;
      };

      screensaver = {
        askForPassword = true;
        askForPasswordDelay = 0;
      };

      spaces.spans-displays = false;

      WindowManager = {
        EnableStandardClickToShowDesktop = false;
        StandardHideDesktopIcons = false;
        HideDesktop = false;
        StageManagerHideWidgets = false;
        StandardHideWidgets = false;
      };

      universalaccess = {
        reduceMotion = false;
        reduceTransparency = true;
      };

      loginwindow = {
        GuestEnabled = false;
        SHOWFULLNAME = true;
      };

      # Keys without a typed nix-darwin option.
      CustomUserPreferences = {
        NSGlobalDomain = {
          AppleSpacesSwitchOnActivate = true;
          WebKitDeveloperExtras = true;
        };
        "com.apple.WindowManager".AnimationSpeed = 5;
        # macOS 26/27 lengthened the Space-switch slide and ships no duration key
        # for it: `workspaces-swoosh-animation-off` and
        # `expose-animation-duration` no longer exist in the Dock binary, and the
        # slide is a spring whose length is not exposed as a preference. The one
        # working key is this one — it stops the Dock animating the switch at
        # all. Trade-off: Dock-icon-follow stops working, including clicking an
        # app icon to jump to the Space holding its windows (see
        # AppleSpacesSwitchOnActivate above). Remove this line to restore both.
        "com.apple.dock".workspaces-auto-swoosh = false;
        "com.apple.desktopservices" = {
          DSDontWriteNetworkStores = true;
          DSDontWriteUSBStores = true;
        };
        "com.apple.AdLib".allowApplePersonalizedAdvertising = false;
        "com.apple.ImageCapture".disableHotPlug = true;
        "com.apple.TimeMachine".DoNotOfferNewDisksForBackup = true;
        "com.apple.Safari" = {
          IncludeDevelopMenu = true;
          WebKitDeveloperExtras = true;
          IncludeInternalDebugMenu = true;
        };
      };
    };

    keyboard = {
      enableKeyMapping = true;
      remapCapsLockToControl = false;
      remapCapsLockToEscape = true;
      swapLeftCommandAndLeftAlt = false;
    };
  };

  security.pam.services.sudo_local.touchIdAuth = true;

  programs.zsh.enable = true;
  environment.shells = [pkgs.zsh];

  time.timeZone = "Asia/Kathmandu";
}
