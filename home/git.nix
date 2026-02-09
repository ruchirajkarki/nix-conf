{
  lib,
  username,
  useremail,
  ...
}: {
  # `programs.git` will generate the config file: ~/.config/git/config
  # to make git use this config file, `~/.gitconfig` should not exist!
  #
  #    https://git-scm.com/docs/git-config#Documentation/git-config.txt---global
  home.activation.removeExistingGitconfig = lib.hm.dag.entryBefore ["checkLinkTargets"] ''
    rm -f ~/.gitconfig
  '';

  programs.git = {
    # enables and configures Git
    enable = true;
    lfs.enable = true;

    # includes = [
    #   {
    #     # use diffrent email & name for work
    #     path = "~/work/.gitconfig";
    #     # condition = "gitdir:~/work/";
    #     condition = "gitdir:/Users/ruchirajkarki/work/**";
    #   }
    # ];

    settings = {
      # TODO replace with your own name & email
      user = {
        name = "ruchirajkarki";
        email = "ruchirajkarki@gmail.com";
      };

      init.defaultBranch = "main";
      push.autoSetupRemote = true;
      pull.rebase = true;

      alias = {
        # gitalias v0.x - Essential goal of Gitalias is to turns git command 
        # into shortest possible sequence of characters (an alias) where the
        # alias does not have to be remembered but it can be mnemotechnically 
        # derived from the full command.
        # https://github.com/ruchirajkarki/gitalias

        # add
        a = "add";
        aa = "add --all";
        ai = "add --interactive";
        ap = "add --patch";
        au = "add --update";

        # branch
        b = "branch";
        ba = "branch --all";
        bav = "branch --all --verbose";
        bavv = "branch --all -vv";
        bc = "branch --copy";
        bd = "branch --delete";
        bdd = "branch -D";
        bdf = "branch --delete --force";
        bm = "branch --move";
        bmm = "branch -M";
        br = "branch --remotes";
        brv = "branch --remotes --verbose";
        buu = "branch --unset-upstream";
        bv = "branch --verbose";
        bvv = "branch -vv";

        # commit
        c = "commit";
        ca = "commit --all";
        cam = "commit --all --message";
        cm = "commit --message";

        # diff
        d = "diff";
        dc = "diff --cached";
        dfi = "diff --full-index";
        dno = "diff --name-only";
        dns = "diff --name-status";
        ds = "diff --stat";

        # rebase
        e = "rebase";
        ea = "rebase --abort";
        ec = "rebase --continue";
        ei = "rebase --interactive";
        em = "rebase main";
        ed = "rebase dev";
        et = "rebase testing";
        ep = "rebase production";
        eo = "rebase --onto";
        es = "rebase --skip";

        # fetch
        f = "fetch";
        fa = "fetch --all";
        ft = "fetch --tags";

        # log
        g = "log";
        ga = "log --all";
        gag = "log --all --grep";
        gf = "log --follow";
        gg = "log --grep";
        gmc = "log --max-count";
        go = "log --oneline";
        gop = "log --oneline --patch";
        gopmc = "log --oneline --patch --max-count";
        gp = "log --patch";
        gpmc = "log --patch --max-count";
        gs = "log --stat";

        # stash
        h = "stash";
        ha = "stash apply";
        hc = "stash clear";
        hd = "stash drop";
        hl = "stash list";
        hp = "stash pop";
        hs = "stash show";

        # config
        i = "config";
        ie = "config --edit";
        ig = "config --global";
        ieg = "config --edit --global";
        il = "config --list";
        is = "config --system";

        # clone
        k = "clone";
        kb = "clone --branch";
        kd = "clone --depth";
        krs = "clone --recurse-submodules";

        # pull
        l = "pull";
        la = "pull --all";
        ld = "pull --depth";
        ldr = "pull --dry-run";
        lnt = "pull --no-tags";
        lp = "pull --prune";
        lq = "pull --quiet";
        lr = "pull --rebase";
        lv = "pull --verbose";

        # merge
        m = "merge";
        ma = "merge --abort";
        mc = "merge --continue";
        mm = "merge main";
        md = "merge dev";
        mt = "merge testing";
        mp = "merge production";
        mnc = "merge --no-commit";
        mncs = "merge --no-commit --squash";
        ms = "merge --squash";

        # clean
        n = "clean";
        ndr = "clean --dry-run";
        nddr = "clean -d --dry-run";
        ndf = "clean -d --force";
        nf = "clean --force";
        nfdr = "clean --force --dry-run";
        ni = "clean --interactive";
        nq = "clean --quiet";
        nx = "clean -x";
        nxdr = "clean -x --dry-run";

        # remote
        o = "remote";
        ov = "remote --verbose";
        oa = "remote add";
        oao = "remote add origin";
        opo = "remote prune origin";
        opodr = "remote prune origin --dry-run";
        osh = "remote set-head";

        # push
        p = "push";
        pa = "push --all";
        pasuo = "push --all --set-upstream origin";
        pd = "push --delete";
        pdo = "push --delete origin";
        pf = "push --force";
        pfwl = "push --force-with-lease";
        po = "push origin";
        pot = "push origin tag";
        psuo = "push --set-upstream origin";
        pt = "push --tags";

        # restore
        r = "restore";
        rs = "restore --staged";

        # switch
        s = "switch";
        sc = "switch --create";
        sdc = "switch --discard-changes";
        sf = "switch --force";
        sfc = "switch --force-create";
        sm = "switch main";
        sd = "switch dev";
        st = "switch testing";
        sp = "switch production";

        # reset
        t = "reset";
        th = "reset --hard";
        tm = "reset --mixed";
        ts = "reset --soft";

        # status
        u = "status";
        uss = "status --show-stash";
        uuf = "status --untracked-files";
        uv = "status --verbose";

        # revert
        v = "revert";
        va = "revert --abort";
        vc = "revert --continue";
        vnc = "revert --no-commit";
        vq = "revert --quit";
        vs = "revert --skip";

        # cherry-pick
        y = "cherry-pick";
        ync = "cherry-pick --no-commit";

        # custom aliases (existing)
        ls = "log --pretty=format:\"%C(yellow)%h%Cred%d\\\\ %Creset%s%Cblue\\\\ [%cn]\" --decorate";
        ll = "log --pretty=format:\"%C(yellow)%h%Cred%d\\\\ %Creset%s%Cblue\\\\ [%cn]\" --decorate --numstat";
        amend = "commit --amend -m";
        update = "submodule update --init --recursive";
        foreach = "submodule foreach";
      };
    };
  };

  programs.delta = {
    # command-line utility to get a better-looking diff output for Git
    enable = true;
    enableGitIntegration = true;
    options = {
      "true-color" = "always";
      "line-numbers" = true;
      navigate = true;
      light = false;

      interactive = {
        "keep-plus-minus-markers" = false;
      };

      decorations = {
        "commit-decoration-style" = "blue ol";
        "commit-style" = "raw";
        "file-style" = "omit";
        "hunk-header-decoration-style" = "blue box";
        "hunk-header-file-style" = "red";
        "hunk-header-line-number-style" = "#067a00";
        "hunk-header-style" = "file line-number syntax";
      };
    };
  };
}
