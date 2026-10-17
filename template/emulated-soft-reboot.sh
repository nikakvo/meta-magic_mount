#!/system/bin/sh
############################################
# meta-mm emulated-soft-reboot.sh
# KernelSU runs this just before a soft reboot stops Android. It only
# leaves a mark for metamount.sh, which then removes this boot's mounts
# and mounts everything again once Android has stopped. Nothing is
# unmounted here, while apps are still running.
############################################

DATA_DIR="/data/adb/magic_mount"
[ -d "$DATA_DIR" ] || exit 0
cat /proc/sys/kernel/random/boot_id > "$DATA_DIR/soft_reboot" 2>/dev/null
exit 0
