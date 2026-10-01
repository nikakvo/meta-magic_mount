const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export const t = {
  tabs: { modules: "Modules", config: "Config", logs: "Logs" },

  boot: {
    title: "Last boot",
    none: "Magic Mount has not run yet. Reboot to start mounting module files.",
    ok: (mounted, modules) =>
      `${plural(mounted, "entry", "entries")} mounted from ${plural(modules, "module", "modules")}. No failures.`,
    okNoLog: "Mounting finished without errors.",
    partial: (mounted, failed, skipped) => {
      const bits = [`${plural(mounted, "entry", "entries")} mounted`];
      if (failed) bits.push(`${failed} failed`);
      if (skipped) bits.push(`${skipped} skipped`);
      return `${bits.join(", ")}. Open Logs for details.`;
    },
    failed: (code) => `Mounting failed (code ${code}). Open Logs for details.`,
    empty: "No module changes any system files, so nothing was mounted.",
    stale:
      "Magic Mount did not run during this boot, so no module files are mounted. Safe mode or a disabled Magic Mount module can cause this.",
    missingBinary: "The mount program is missing. Reinstall Magic Mount.",
    failedModules: "Modules with failures:",
    timing: (at, took) => `Ran ${at} after boot, took ${took}`,
  },

  modules: {
    title: "Modules",
    intro:
      "Modules that change system files. Switch one off to stop mounting its files without disabling the module.",
    dir: "Module directory",
    empty: "No installed module changes system files.",
    loadError: "Could not read the module directory. Check the path in Config.",
    toggleError: "Could not change this module. Try again.",
    reload: "Reload list",
    toggleLabel: (name) => `Mount files from ${name}`,
    // notes under a module
    disabled: "Disabled in the manager",
    removing: "Will be removed at the next reboot",
    external: "Switched off by a skip_mount file this app did not create",
    // pending changes
    willMount: "Mounts after reboot",
    willUnmount: "Stops mounting after reboot",
    willUpdate: "Update installed, new files apply after reboot",
    pending: (n) => `${plural(n, "module change applies", "module changes apply")} after reboot.`,
    pendingConfig: "Configuration changes apply after reboot.",
  },

  conflicts: {
    title: "Conflicts",
    intro:
      "Files that more than one enabled module ships. Checked against what the next boot will mount, including installed updates.",
    checking: "Checking…",
    error: "Could not check for conflicts.",
    none: "No conflicts. No two modules ship the same file.",
    usedOver: "is used instead of",
    entries: (n) => plural(n, "entry", "entries"),
    showFiles: "Show files",
    kindType: "file, folder or link",
    prefer: (name) => `Use ${name} instead`,
    preferError: "Could not save the new order.",
    empties: "empties",
    replaceNote: (other) => `Files that ${other} adds there stay; the folder's own files are hidden.`,
    same: (n) =>
      `${plural(n, "identical file is", "identical files are")} shipped by more than one module. No effect.`,
    order: "Preferred modules",
    orderHelp:
      "When two modules ship the same file, the module listed first wins. Other modules follow by id.",
    orderNone: "None. Conflicts are won by module id, in alphabetical order.",
    resetOrder: "Clear order",
    unreadable: "Could not read these modules, their files are not mounted:",
    others: "Other modules that also mount module files:",
    othersHelp:
      "Only one module should do this. Remove the others, otherwise the same files are mounted twice.",
    recheck: "Check again",
  },

  config: {
    title: "Configuration",
    loadError: "Could not read the configuration file. Defaults are shown.",
    saved: "Saved.",
    saveError: "Could not save the configuration file.",
    invalid: "Fix the highlighted fields first.",
    saving: "Saving…",
    save: "Save changes",
    discard: "Discard changes",
    defaults: "Reset to defaults",
    unsaved: "Unsaved changes.",
    pending: "Saved changes apply after reboot.",
    path: "Configuration file",
    logLevel: "Log detail",
    logLevelHelp:
      "Detailed logging records every file operation. Useful for troubleshooting, otherwise leave it on Normal.",
    normal: "Normal",
    detailed: "Detailed",
    umount: "Unmount for hidden apps",
    umountHelp:
      "Registers every mount with KernelSU, so it can unmount the module files for apps where the manager's Umount modules option is active.",
    off: "Off",
    on: "On",
    moduleDir: "Module directory",
    moduleDirHelp: "Where installed modules live. Only change this if you know why.",
    tempDir: "Work directory",
    tempDirHelp:
      "Temporary space used while mounting at boot. Leave empty and the best location is picked automatically.",
    mountSource: "Mount name",
    mountSourceHelp:
      "Name shown for these mounts in /proc/mounts. Keep KSU unless a module needs something else.",
    logFile: "Log file",
    logFileHelp:
      "The previous boot's log is kept next to it as .old. Leave empty to turn file logging off.",
    partitions: "Extra partitions",
    priority: "Preferred modules",
    priorityHelp:
      "Module ids, separated with commas. When two modules ship the same file, the one listed first wins; modules not listed follow in alphabetical order of their id. The Conflicts card on the Modules tab fills this in for you.",
    partitionsHelp:
      "System, vendor, product, system_ext and odm are always handled. Add other partitions only if a module ships a folder for one, for example mi_ext on Xiaomi or my_stock on OnePlus. Separate with commas.",
    errors: {
      required: "Required.",
      path: "Use an absolute path such as /data/adb/…, without spaces, quotes or #.",
      source: "Letters, digits, dot, dash and underscore only (up to 32).",
      partName: (names) => `Not a valid partition name: ${names}`,
      partBuiltin: (names) => `Always handled or not allowed here: ${names}`,
      moduleId: (names) => `Not a valid module id: ${names}`,
    },
  },

  logs: {
    title: "Logs",
    current: "This boot",
    previous: "Previous boot",
    refresh: "Refresh",
    refreshing: "Reading…",
    written: (when) => `Written ${when}`,
    read: (time) => `read ${time}`,
    wrap: "Wrap lines",
    problems: "Only warnings and errors",
    empty: "This log is empty.",
    noProblems: "No warnings or errors in this log.",
    readError: "Could not read the log file.",
    disabled: "Logging to a file is turned off. Set a log file in Config.",
    stats: (lines, warns, errors) =>
      `${plural(lines, "line", "lines")} · ${plural(warns, "warning", "warnings")} · ${plural(errors, "error", "errors")}`,
  },

  loading: "Loading…",
};
