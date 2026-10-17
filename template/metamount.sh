#!/system/bin/sh
############################################
# meta-mm metamount.sh
# Runs the magic mount core once per boot.
#
# Besides mounting, it records what this boot looked like so the WebUI
# can tell which changes are still waiting for a reboot:
#   status      - when mmd ran, how long it took, exit code, boot id
#                 (service.sh adds boot_start once the clock is set)
#   status.old  - the same record for the boot that wrote mm.log.old
#   boot_state  - every module and whether it was mounted this boot
#   boot_config - the configuration this boot used
#   mounts      - the mounts mmd made this boot (to remove them again)
#
# It runs once per boot; a second call during the same boot does nothing,
# except when Android itself restarts on the same kernel (soft reboot):
# then the previous mounts are removed and everything is mounted again,
# so module changes apply like after a full reboot. See may_run_again.
# It never blocks boot: every path ends in "exit 0".
############################################

MODDIR="${0%/*}"
BINARY="$MODDIR/mmd"
DATA_DIR="/data/adb/magic_mount"
CONFIG="$DATA_DIR/mm.conf"
STATUS="$DATA_DIR/status"
STATUS_OLD="$DATA_DIR/status.old"
BOOT_STATE="$DATA_DIR/boot_state"
BOOT_CONFIG="$DATA_DIR/boot_config"
SKIP_LIST="$DATA_DIR/skip_mount.list"
MOUNTS="$DATA_DIR/mounts"
SOFT_MARK="$DATA_DIR/soft_reboot"

log() {
    echo "[meta-mm] $*"
}

# Print the value of a key from mm.conf, parsed the way mmd does:
# whole-line "#" comments, first "=" splits, keys are case-insensitive,
# the last occurrence wins.
conf_get() {
    [ -f "$CONFIG" ] || return 0
    _want="$(echo "$1" | tr 'A-Z' 'a-z')"
    _val=""
    while IFS= read -r _line || [ -n "$_line" ]; do
        _line="$(echo "$_line" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')"
        case "$_line" in
            ''|'#'*) continue ;;
            *=*) ;;
            *) continue ;;
        esac
        _key="$(echo "${_line%%=*}" | sed 's/[[:space:]]*$//' | tr 'A-Z' 'a-z')"
        [ "$_key" = "$_want" ] || continue
        _v="$(echo "${_line#*=}" | sed 's/^[[:space:]]*//')"
        # mmd ignores keys with an empty value
        [ -n "$_v" ] && _val="$_v"
    done < "$CONFIG"
    echo "$_val"
}

# Uptime in centiseconds, e.g. "1234.56" -> 123456
uptime_cs() {
    _up="$(cut -d' ' -f1 /proc/uptime 2>/dev/null)"
    _s="${_up%%.*}"
    _f="${_up#*.}"
    [ "$_f" = "$_up" ] && _f=0
    _f="$(printf '%s00' "$_f" | cut -c1-2)"
    case "$_f" in 0?) _f="${_f#0}" ;; esac
    case "$_s" in ''|*[!0-9]*) echo 0; return ;; esac
    case "$_f" in ''|*[!0-9]*) _f=0 ;; esac
    echo $(( _s * 100 + _f ))
}

write_status() {
    # $1 = result (ok | failed | missing-binary), $2 = exit code
    _tmp="$STATUS.tmp"
    {
        echo "boot_id=$BOOT_ID"
        echo "result=$1"
        echo "exit_code=$2"
        echo "root=${AOK:-unknown}"
        echo "version=$MODULE_VERSION"
        echo "start_cs=$START_CS"
        echo "end_cs=$(uptime_cs)"
        if [ "$AGAIN" = 1 ]; then
            echo "soft_reboot=1"
            # Same kernel boot, so the same start time: service.sh only
            # adds it when missing
            [ -n "$PREV_BOOT_START" ] && echo "boot_start=$PREV_BOOT_START"
        fi
    } > "$_tmp" && mv -f "$_tmp" "$STATUS"
    chmod 0644 "$STATUS" 2>/dev/null
}

# Recorded mounts of this boot that are still in place, one
# "<mount id><TAB><mount point>" per line, in the order they were made.
mounts_present() {
    awk -F'\t' 'NR == FNR { split($0, f, " "); live[f[1] " " f[5]] = 1; next }
        FNR > 1 && (($1 " " $2) in live)' /proc/self/mountinfo "$MOUNTS" 2>/dev/null
}

# Same boot_id as the last run: mount again only when Android itself
# restarted on the same kernel and the old mounts are gone, or are ours
# to remove. Every other case keeps today's mounts (never a second set).
may_run_again() {
    if [ "$(getprop sys.boot_completed 2>/dev/null)" = "1" ]; then
        log "Already ran during this boot, not mounting again"
        return 1
    fi
    if [ "$(head -n 1 "$MOUNTS" 2>/dev/null)" != "boot_id=$BOOT_ID" ]; then
        log "Android restarted, but this boot's mounts were not recorded; keeping them"
        return 1
    fi
    _left="$(mounts_present)"
    if [ -n "$_left" ]; then
        if [ "$(cat "$SOFT_MARK" 2>/dev/null)" != "$BOOT_ID" ]; then
            log "Android restarted, previous mounts are still in place; keeping them"
            return 1
        fi
        log "Soft reboot: removing the previous mounts"
        # newest first, so nested mounts go before their parents
        echo "$_left" | sed -n '1!G;h;$p' | while IFS="$(printf '\t')" read -r _id _mp; do
            umount -l "$_mp" 2>/dev/null || log "Could not unmount $_mp"
        done
        _left="$(mounts_present)"
        if [ -n "$_left" ]; then
            log "Soft reboot: $(echo "$_left" | wc -l) previous mounts could not be removed; keeping them"
            return 1
        fi
    fi
    log "Android restarted on the same kernel, mounting again"
    return 0
}

mkdir -p "$DATA_DIR"

START_CS="$(uptime_cs)"
BOOT_ID="$(cat /proc/sys/kernel/random/boot_id 2>/dev/null)"

# Once per boot. Running again (by hand, or by another tool calling this
# script) would stack a second set of mounts over the first one.
AGAIN=0
PREV_BOOT_START=""
if [ -n "$BOOT_ID" ] && [ -f "$STATUS" ] &&
    [ "$(sed -n 's/^boot_id=//p' "$STATUS" | head -n 1)" = "$BOOT_ID" ]; then
    if ! may_run_again; then
        rm -f "$SOFT_MARK"
        exit 0
    fi
    AGAIN=1
    PREV_BOOT_START="$(sed -n 's/^boot_start=//p' "$STATUS" | head -n 1)"
fi
# The mark is only for the next run (written by emulated-soft-reboot.sh)
rm -f "$SOFT_MARK"
MODULE_VERSION="$(sed -n 's/^version=//p' "$MODDIR/module.prop" 2>/dev/null | head -n 1)"

# Root implementation recorded at install time (KSU / APATCH)
AOK=""
if [ -f "$MODDIR/aok" ]; then
    AOK="$(sed -n 's/^AOK=//p' "$MODDIR/aok" | head -n 1)"
fi

# Copy of the config this boot used, so the WebUI can tell whether the
# file has been changed since.
if [ -f "$CONFIG" ]; then
    cp -f "$CONFIG" "$BOOT_CONFIG" && chmod 0644 "$BOOT_CONFIG"
else
    rm -f "$BOOT_CONFIG"
fi

MOD_DIR="$(conf_get module_dir)"
[ -n "$MOD_DIR" ] || MOD_DIR="/data/adb/modules"

# Rotate the previous boot's log to *.old
LOG_FILE="$(conf_get log_file)"
LOG_ROTATED=0
if [ -n "$LOG_FILE" ] && [ "$LOG_FILE" != "-" ]; then
    mkdir -p "${LOG_FILE%/*}" 2>/dev/null
    if [ -s "$LOG_FILE" ]; then
        mv -f "$LOG_FILE" "$LOG_FILE.old" && LOG_ROTATED=1
    fi
fi

# status.old must describe the boot that wrote mm.log.old. When the log
# was not rotated, mm.log.old (if any) is older than the last status, so
# there is no matching record. status itself stays until write_status
# replaces it: if this script dies early the WebUI still sees that
# Magic Mount did not finish this boot.
if [ "$LOG_ROTATED" = 1 ] && [ -s "$STATUS" ]; then
    cp -f "$STATUS" "$STATUS_OLD.tmp" && mv -f "$STATUS_OLD.tmp" "$STATUS_OLD"
    chmod 0644 "$STATUS_OLD" 2>/dev/null
else
    rm -f "$STATUS_OLD"
fi

# Re-apply "mounting off" choices made in the WebUI. When a module is
# updated, KernelSU replaces its folder and the skip_mount file is lost;
# the list keeps the user's choice across module updates.
if [ -f "$SKIP_LIST" ]; then
    while IFS= read -r id || [ -n "$id" ]; do
        case "$id" in
            ''|*[!A-Za-z0-9._-]*|.|..) continue ;;
        esac
        m="$MOD_DIR/$id"
        if [ -d "$m" ] && [ ! -e "$m/skip_mount" ]; then
            touch "$m/skip_mount" && log "Re-applied skip_mount for $id"
        fi
    done < "$SKIP_LIST"
fi

# Snapshot of every module as mmd is about to see it
{
    for m in "$MOD_DIR"/*; do
        [ -d "$m" ] || continue
        id="${m##*/}"
        if [ -e "$m/remove" ]; then
            state=remove
        elif [ -e "$m/disable" ]; then
            state=disable
        elif [ -e "$m/skip_mount" ]; then
            state=skip
        else
            state=on
        fi
        printf '%s\t%s\n' "$id" "$state"
    done
} > "$BOOT_STATE.tmp" 2>/dev/null && mv -f "$BOOT_STATE.tmp" "$BOOT_STATE"
chmod 0644 "$BOOT_STATE" 2>/dev/null

if [ ! -x "$BINARY" ]; then
    log "ERROR: binary not found or not executable: $BINARY"
    write_status missing-binary 127
    exit 0
fi

log "Root: ${AOK:-unknown}, executing $BINARY"

# Record which mounts mmd makes, so a soft reboot can remove them again
MOUNTS_BEFORE="$DATA_DIR/.mounts_before"
cut -d' ' -f1 /proc/self/mountinfo > "$MOUNTS_BEFORE" 2>/dev/null

"$BINARY"
EXIT_CODE=$?

# Only the top-level ones: removing /system/bin also removes every mount
# inside it (mmd mirrors each original file as its own bind mount).
{
    echo "boot_id=$BOOT_ID"
    awk 'NR == FNR { seen[$1] = 1; next }
        !($1 in seen) { n++; id[n] = $1; mp[n] = $5 }
        END {
            for (i = 1; i <= n; i++) {
                top = 1
                for (j = 1; j <= n; j++)
                    if (j != i && index(mp[i], mp[j] "/") == 1) { top = 0; break }
                if (top) print id[i] "\t" mp[i]
            }
        }' "$MOUNTS_BEFORE" /proc/self/mountinfo
} > "$MOUNTS.tmp" 2>/dev/null && mv -f "$MOUNTS.tmp" "$MOUNTS"
chmod 0644 "$MOUNTS" 2>/dev/null
rm -f "$MOUNTS_BEFORE"

# Tell KernelSU that mounting is done, also when mmd failed: a failure
# can come after some mounts are already live, and KernelSU's per-app
# umount stays off for the whole boot until it gets this call.
# Only KernelSU's ksud knows this command.
if [ "$AOK" != "APATCH" ] && [ -x /data/adb/ksud ]; then
    /data/adb/ksud kernel notify-module-mounted
fi

if [ "$EXIT_CODE" = 0 ]; then
    write_status ok 0
    log "Mount completed successfully"
else
    write_status failed "$EXIT_CODE"
    log "Mount failed with exit code $EXIT_CODE"
fi

# Never block boot, even if mounting failed
exit 0
