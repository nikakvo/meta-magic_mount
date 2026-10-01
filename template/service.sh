#!/system/bin/sh
############################################
# meta-mm service.sh
# Adds the real (wall clock) start time of this boot to the status
# record, as boot_start=<epoch seconds>.
#
# metamount.sh runs in post-fs-data, before Android has set the clock,
# so file times written there are wrong on phones whose RTC does not
# keep the date. Uptime values are right, so status holds start_cs /
# end_cs from /proc/uptime; this script adds the one missing piece once
# the clock can be trusted: boot_start = now - uptime.
#
# The WebUI uses it to show when the previous boot's log was written.
# It never loops forever: after TIMEOUT seconds it gives up and the
# WebUI simply shows no time for that boot.
############################################

MODDIR="${0%/*}"
DATA_DIR="/data/adb/magic_mount"
STATUS="$DATA_DIR/status"
STATUS_OLD="$DATA_DIR/status.old"
TIMEOUT=600
STEP=5
# 2026-01-01 00:00 UTC. A clock earlier than this has not been set yet.
FLOOR=1767225600

is_num() {
    case "$1" in ''|*[!0-9]*) return 1 ;; esac
    return 0
}

status_get() {
    # $1 = file, $2 = key
    sed -n "s/^$2=//p" "$1" 2>/dev/null | head -n 1
}

BOOT_ID="$(cat /proc/sys/kernel/random/boot_id 2>/dev/null)"

# True while status is the record of this boot and has no boot_start yet
status_needs_stamp() {
    [ -f "$STATUS" ] || return 1
    _sid="$(status_get "$STATUS" boot_id)"
    if [ -n "$BOOT_ID" ] && [ -n "$_sid" ] && [ "$_sid" != "$BOOT_ID" ]; then
        return 1
    fi
    [ -z "$(status_get "$STATUS" boot_start)" ]
}

status_needs_stamp || exit 0

# Raise the floor with times known to be real, so an RTC that comes up
# with a plausible-looking but old date is not taken as set:
#   - this boot cannot have started before Magic Mount was installed
#     (the installer copied module.prop while the clock was right),
#   - nor before the previous boot started.
raise_floor() {
    if is_num "$1" && [ "$1" -gt "$FLOOR" ]; then
        FLOOR="$1"
    fi
}
raise_floor "$(stat -c %Y "$MODDIR/module.prop" 2>/dev/null)"
raise_floor "$(status_get "$STATUS_OLD" boot_start)"

BOOT_START=""
waited=0
while [ "$waited" -lt "$TIMEOUT" ]; do
    if [ "$(getprop sys.boot_completed)" = "1" ]; then
        up="$(cut -d. -f1 /proc/uptime 2>/dev/null)"
        now="$(date +%s 2>/dev/null)"
        if is_num "$up" && is_num "$now"; then
            bs=$(( now - up ))
            if [ "$bs" -gt "$FLOOR" ]; then
                BOOT_START="$bs"
                break
            fi
        fi
    fi
    sleep "$STEP"
    waited=$(( waited + STEP ))
done

[ -n "$BOOT_START" ] || exit 0

# Check again: status must still be this boot's record
status_needs_stamp || exit 0

_tmp="$STATUS.boot_start.tmp"
{
    cat "$STATUS"
    echo "boot_start=$BOOT_START"
} > "$_tmp" && mv -f "$_tmp" "$STATUS"
chmod 0644 "$STATUS" 2>/dev/null
rm -f "$_tmp" 2>/dev/null

exit 0
