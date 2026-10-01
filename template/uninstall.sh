#!/system/bin/sh
############################################
# meta-mm uninstall.sh
# Runs when Magic Mount itself is removed.
#
# Puts things back the way they were before Magic Mount:
#   - removes only the skip_mount files the WebUI created
#     (skip_mount files shipped by module authors are left alone),
#   - removes the /data/adb/metamodule link if it still points here,
#   - deletes Magic Mount's own data (config, logs, boot records).
############################################

MODULE_ID="meta-mm"
DATA_DIR="/data/adb/magic_mount"
CONFIG="$DATA_DIR/mm.conf"
SKIP_LIST="$DATA_DIR/skip_mount.list"
METAMODULE_LINK="/data/adb/metamodule"

# Module directory from the config (the WebUI only writes plain values)
MOD_DIR="$(sed -n 's/^[[:space:]]*[Mm][Oo][Dd][Uu][Ll][Ee]_[Dd][Ii][Rr][[:space:]]*=[[:space:]]*//p' "$CONFIG" 2>/dev/null | tail -n 1)"
[ -n "$MOD_DIR" ] || MOD_DIR="/data/adb/modules"

if [ -f "$SKIP_LIST" ]; then
    while IFS= read -r id || [ -n "$id" ]; do
        case "$id" in
            ''|*[!A-Za-z0-9._-]*|.|..) continue ;;
        esac
        rm -f "$MOD_DIR/$id/skip_mount"
    done < "$SKIP_LIST"
fi

# KernelSU removes the link itself before this script runs; APatch may not
if [ -L "$METAMODULE_LINK" ]; then
    target="$(readlink "$METAMODULE_LINK")"
    target="${target%/}"
    [ "${target##*/}" = "$MODULE_ID" ] && rm -f "$METAMODULE_LINK"
fi

rm -rf "$DATA_DIR"

exit 0
