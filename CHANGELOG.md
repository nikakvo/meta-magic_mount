# Changelog

## v1.2.0

- Conflicts: a new card on the Modules tab shows which modules ship the same file and which copy is used, checked against what the next boot will mount (switches, disabled modules and installed updates included). "Use … instead" makes the other module win from the next boot on.
- Mount order: when two modules ship the same file, the winner is now always the same (preferred modules first, then by module ID). It used to depend on the order the file system happened to list the modules in. Preferred modules can also be set in Config.
- Fixed: a module shipping a file where another module ships a folder (or the other way round) stopped every module from being mounted, while the boot card said there was nothing to mount. Now only that one path is affected, and it is listed as a conflict.
- Fixed: a problem while reading the modules is now reported as a failed mount instead of "nothing to mount". A module whose files cannot be read no longer stops the others; it is listed on the boot card.
- Fixed: modules installed with KernelSU's own layout (vendor/ next to system/) are merged with the others. Depending on the order, only one such module's vendor, product or system_ext files were used before.
- Fixed: a module that ships only an extra partition folder (for example mi_ext) and no system files was not mounted.
- Fixed: a .replace folder is honored whichever module ships it.
- Magic Mount runs once per boot. A second call during the same boot is ignored instead of mounting everything a second time.
- The installer and the Conflicts card warn when another module that mounts module files (a second metamodule, mountify) is installed.
- New animated logo in the interface (and a matching module icon). It turns faster while the interface reads from the device.
- Command line: mmd --dry-run prints the mount order and the conflicts without mounting anything; also --priority and --version.

## v1.1.6

- Logs: the "Written" time is now correct. It was taken from the log file's date, which is set early in boot before the phone's clock is, so it could show a date like "Jan 5". This boot's time is now worked out from how long the phone has been running; the previous boot's time is recorded once the clock is set after boot. When no reliable time exists (for example the previous boot right after updating), it is left out instead of shown wrong.
- Logs: when Magic Mount did not run during this boot, "This boot" now shows when the log it displays was really written.

## v1.1.5

- Logs: shows when each log was written, so this boot and the previous boot can be told apart (the log lines have no times), and when it was last read; the Refresh button shows that it is reading.

## v1.1.4

- Help page (Help button in the top bar): what Magic Mount does, what happens at boot, how module files are applied, every tab and setting, install / update / uninstall, command line, troubleshooting and file layout.

## v1.1.3

- The "changes apply after reboot" notice is now exact: it compares with what the current boot actually mounted, disappears when a switch is turned back, survives tab switches and reopening the WebUI, and each affected module shows what will change (mounts / stops mounting / update installed).
- Modules switched off in the WebUI stay off after the module is updated (KernelSU does not carry `skip_mount` over on updates).
- Uninstalling Magic Mount removes only the `skip_mount` files the WebUI created; files shipped by module authors are left alone.
- Last boot card shows when Magic Mount ran and how long it took, reports skipped files, and warns when Magic Mount did not run during this boot.
- Modules with an installed update or a pending removal are marked.
- Config: fields are validated (invalid partition names are no longer silently dropped), unsaved and not-yet-applied changes are shown, saving is atomic, "Reset to defaults" added.
- Logs: line, warning and error counts; clear message when file logging is off.
- Core: a wrong log file path no longer stops all mounting; the log folder is created if missing; logs are printed when no log file is set; "Nodes skipped" is counted.
