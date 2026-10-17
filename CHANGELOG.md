# Changelog

## v1.3.0

- Find a file: see which modules ship a path and which copy the next boot uses.
- Conflicts card warns when a module ships a folder for a partition missing from Extra partitions, with a button to add it.
- Soft reboot from the root manager now applies module changes, as a full reboot does.
- Fixed: on KernelSU, a partial mount failure no longer leaves module files visible to apps hidden from root.
- Fixed: modules that request hot install are now installed by the root manager alone, not twice.
- Fixed: the Last boot card now counts modules that only ship an extra partition.

---

## v1.2.2

- The module now shows a banner image on its card in the root manager.

---

## v1.2.1

- Help page: the command line examples now use su -c with full paths, tested on a device.

---

## v1.2.0

- Conflicts card: shows which modules ship the same file and which copy is used; one tap lets the other module win.
- Stable mount order: the same module always wins a conflict (preferred modules first, then by ID). Preferred modules can be set in Config.
- Fixed: a file in one module and a folder with the same name in another stopped all modules from mounting.
- Fixed: modules installed with KernelSU's own layout (vendor/ next to system/) now merge with the others.
- Fixed: modules that ship only an extra partition (e.g. mi_ext), and .replace folders from any module, now work.
- Mount problems are shown on the boot card instead of "nothing to mount"; one unreadable module no longer stops the others.
- Runs once per boot, and warns when another mount module is installed.
- New animated logo and module icon.
