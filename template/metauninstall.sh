#!/system/bin/sh
############################################
# meta-mm metauninstall.sh
# KernelSU runs this when another module is removed, with MODULE_ID set.
# Forget that module in the WebUI's skip list, so the list only ever
# names installed modules.
############################################

SKIP_LIST="/data/adb/magic_mount/skip_mount.list"

case "$MODULE_ID" in
    ''|*[!A-Za-z0-9._-]*|.|..) exit 0 ;;
esac

if [ -f "$SKIP_LIST" ] && grep -qxF "$MODULE_ID" "$SKIP_LIST"; then
    grep -vxF "$MODULE_ID" "$SKIP_LIST" > "$SKIP_LIST.tmp"
    mv -f "$SKIP_LIST.tmp" "$SKIP_LIST"
    chmod 0644 "$SKIP_LIST"
fi

exit 0
