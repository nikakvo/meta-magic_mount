#!/bin/sh
# Tests for the mount tree (conflicts, mount order, partition layouts).
# Uses --dry-run, so nothing is mounted and no root is needed.
#   usage: tests/dryrun.sh <mmd binary for this machine>

MMD="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
[ -x "$MMD" ] || { echo "usage: $0 <mmd>"; exit 2; }

T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
FAIL=0
PASS=0

mod() { mkdir -p "$T/$CASE/modules/$1"; }
file() { mkdir -p "$(dirname "$T/$CASE/modules/$1")"; printf '%s' "$2" > "$T/$CASE/modules/$1"; }
run() { "$MMD" --dry-run -c /dev/null -m "$T/$CASE/modules" "$@" 2>"$T/$CASE.err"; }

expect() { # <description> <grep -x pattern> <output>
    if printf '%s\n' "$3" | grep -qx -- "$2"; then
        PASS=$((PASS + 1))
    else
        FAIL=$((FAIL + 1))
        echo "FAIL [$CASE] $1"
        echo "  wanted: $2"
        printf '%s\n' "$3" | sed 's/^/  got:    /'
    fi
}
reject() { # <description> <grep -x pattern> <output>
    if printf '%s\n' "$3" | grep -qx -- "$2"; then
        FAIL=$((FAIL + 1))
        echo "FAIL [$CASE] $1 (unexpected: $2)"
    else
        PASS=$((PASS + 1))
    fi
}
TAB="$(printf '\t')"

# 1. File in one module, folder in another: reported, others still mounted
#    (this used to abort all mounting)
CASE=type
file a-mod/system/etc/foo "file"
file b-mod/system/etc/foo/inner "x"
file c-mod/system/bin/tool "z"
out="$(run)"
expect "type conflict reported" "conflict${TAB}type${TAB}system/etc/foo${TAB}a-mod${TAB}b-mod" "$out"
expect "tree still built" "result${TAB}ok${TAB}3${TAB}1" "$out"

# 2. Same file, different / identical content
CASE=file
file a-mod/system/etc/hosts "one"
file b-mod/system/etc/hosts "two"
file a-mod/system/etc/same "same"
file b-mod/system/etc/same "same"
out="$(run)"
expect "different content" "conflict${TAB}file${TAB}system/etc/hosts${TAB}a-mod${TAB}b-mod" "$out"
expect "identical content" "conflict${TAB}same${TAB}system/etc/same${TAB}a-mod${TAB}b-mod" "$out"

# 3. Order is by id, preferred modules first
expect "alphabetical order" "order${TAB}1${TAB}a-mod${TAB}installed" "$out"
out="$(run --priority b-mod)"
expect "preferred module wins" "conflict${TAB}file${TAB}system/etc/hosts${TAB}b-mod${TAB}a-mod" "$out"
expect "preferred module first" "order${TAB}1${TAB}b-mod${TAB}installed" "$out"
out="$("$MMD" --dry-run -c /dev/null -m "$T/$CASE/modules" -P "nope, b-mod" 2>/dev/null)"
expect "unknown ids in the list are harmless" "order${TAB}1${TAB}b-mod${TAB}installed" "$out"

# 4. Priority from the config file
printf 'priority = b-mod\n' > "$T/prio.conf"
out="$("$MMD" --dry-run -c "$T/prio.conf" -m "$T/$CASE/modules" 2>/dev/null)"
expect "priority key in config" "order${TAB}1${TAB}b-mod${TAB}installed" "$out"

# 5. A later module empties a folder another one adds to
CASE=replace
file a-mod/system/app/Foo/extra.txt "add"
file b-mod/system/app/Foo/.replace ""
out="$(run)"
expect "replace honoured whatever the order" "conflict${TAB}replace${TAB}system/app/Foo${TAB}b-mod${TAB}a-mod" "$out"

# 6. KernelSU layout (system/vendor -> ../vendor) merges with the plain one
CASE=layout
file a-mod/system/vendor/etc/x "a"
file b-mod/vendor/etc/x "b"
mkdir -p "$T/$CASE/modules/b-mod/system"
ln -s ../vendor "$T/$CASE/modules/b-mod/system/vendor"
out="$(run)"
expect "both layouts merged into one vendor" "conflict${TAB}file${TAB}system/vendor/etc/x${TAB}a-mod${TAB}b-mod" "$out"
reject "link is not a conflict" "conflict${TAB}type${TAB}system/vendor${TAB}a-mod${TAB}b-mod" "$out"

# 7. disable / remove / skip_mount are left out
CASE=flags
file a-mod/system/bin/a "a"
file b-mod/system/bin/a "b"; : > "$T/$CASE/modules/b-mod/disable"
file c-mod/system/bin/a "c"; : > "$T/$CASE/modules/c-mod/remove"
file d-mod/system/bin/a "d"; : > "$T/$CASE/modules/d-mod/skip_mount"
out="$(run)"
expect "only the enabled module counts" "result${TAB}ok${TAB}1${TAB}0" "$out"

# 8. Pending updates are what the next boot uses
CASE=update
file a-mod/system/bin/a "old"
file b-mod/system/bin/a "b"
: > "$T/$CASE/modules/a-mod/update"
mkdir -p "$T/$CASE/modules_update/a-mod/system/bin"
printf 'b' > "$T/$CASE/modules_update/a-mod/system/bin/a"
out="$(run)"
expect "update dir used" "order${TAB}1${TAB}a-mod${TAB}update" "$out"
expect "update content compared" "conflict${TAB}same${TAB}system/bin/a${TAB}a-mod${TAB}b-mod" "$out"

# 9. Nothing to mount is not an error
CASE=empty
mod a-mod
out="$(run)"
expect "empty result" "result${TAB}empty${TAB}1${TAB}0" "$out"

# 10. Missing module folder is an error
CASE=missing
out="$("$MMD" --dry-run -c /dev/null -m "$T/does-not-exist" 2>/dev/null)"; rc=$?
expect "error result" "result${TAB}error${TAB}0${TAB}0" "$out"
[ "$rc" = 1 ] && PASS=$((PASS + 1)) || { FAIL=$((FAIL + 1)); echo "FAIL [missing] exit code $rc"; }

# 11. Extra partition with no system files at all (used to be dropped)
if [ -d /opt ] && [ ! -L /opt ]; then
    CASE=extra
    file a-mod/opt/thing "x"
    out="$(run -p opt)"
    expect "extra-partition-only module mounted" "result${TAB}ok${TAB}1${TAB}0" "$out"
fi

# 12. Folder for a partition that is not in partitions= is reported
#     (only real partitions: mounted ext4 / erofs / f2fs at /<name>)
CASE=unlisted
cat > "$T/mountinfo" <<'MI'
1 0 253:7 / /mi_ext ro,relatime master:8 - erofs /dev/block/dm-7 ro
2 0 0:19 / /config rw,nosuid master:31 - configfs none rw
3 0 253:5 / /vendor ro,relatime master:12 - erofs /dev/block/dm-5 ro
4 0 253:9 / /bin ro,relatime - ext4 /dev/block/dm-9 ro
5 0 253:8 / /my_part ro,relatime - f2fs /dev/block/dm-8 ro
6 0 253:6 / /mi_ext/sub ro,relatime - erofs /dev/block/dm-6 ro
MI
file a-mod/mi_ext/etc/x "a"
file a-mod/config/x "c"
file a-mod/cust/x "c"
file a-mod/bin/tool "b"
file a-mod/webroot/index.html "w"
file a-mod/vendor/etc/y "v"
file b-mod/mi_ext/etc/z "b"; : > "$T/$CASE/modules/b-mod/disable"
mod c-mod; ln -s ../a-mod/mi_ext "$T/$CASE/modules/c-mod/mi_ext"
file d-mod/my_part/f "d"
out="$(MM_TEST_MOUNTINFO="$T/mountinfo" run)"
expect "format version 2" "mmd-dry-run${TAB}2${TAB}.*" "$out"
expect "unlisted erofs partition" "unlisted${TAB}mi_ext${TAB}a-mod" "$out"
expect "unlisted f2fs partition" "unlisted${TAB}my_part${TAB}d-mod" "$out"
reject "configfs is not a partition" "unlisted${TAB}config${TAB}.*" "$out"
reject "not mounted is not a partition" "unlisted${TAB}cust${TAB}.*" "$out"
reject "blacklisted names never" "unlisted${TAB}bin${TAB}.*" "$out"
reject "built-in partitions never" "unlisted${TAB}vendor${TAB}.*" "$out"
reject "disabled module ignored" "unlisted${TAB}mi_ext${TAB}b-mod" "$out"
reject "symlinked folder ignored" "unlisted${TAB}mi_ext${TAB}c-mod" "$out"
out="$(MM_TEST_MOUNTINFO="$T/mountinfo" run -p mi_ext)"
reject "listed partition not reported" "unlisted${TAB}mi_ext${TAB}a-mod" "$out"
expect "other ones still reported" "unlisted${TAB}my_part${TAB}d-mod" "$out"
out="$(MM_TEST_MOUNTINFO="$T/does-not-exist" run)"
reject "no mountinfo, no report" "unlisted${TAB}.*" "$out"
expect "and the result is unchanged" "result${TAB}empty${TAB}3${TAB}0" "$out"

# 13. --which: who ships a path and which copy the next boot uses
CASE=which
file a-mod/system/etc/hosts "one"
file b-mod/system/etc/hosts "two"
file c-mod/system/etc/hosts "off"; : > "$T/$CASE/modules/c-mod/disable"
file d-mod/vendor/etc/v "d"
mkdir -p "$T/$CASE/modules/d-mod/system"; ln -s ../vendor "$T/$CASE/modules/d-mod/system/vendor"
file e-mod/system/vendor/etc/v "e"
file f-mod/mi_ext/x "f"
file g-mod/system/bin/old "g"
: > "$T/$CASE/modules/g-mod/update"
mkdir -p "$T/$CASE/modules_update/g-mod/system/bin"
printf 'new' > "$T/$CASE/modules_update/g-mod/system/bin/new"
wp() { p="$1"; shift; "$MMD" --which "$p" -c /dev/null -m "$T/$CASE/modules" "$@" 2>/dev/null; }
out="$(wp /system/etc/hosts)"
expect "which header" "mmd-which${TAB}1${TAB}.*" "$out"
expect "first module used" "module${TAB}a-mod${TAB}used${TAB}file${TAB}installed" "$out"
expect "other one ignored" "module${TAB}b-mod${TAB}ignored${TAB}file${TAB}installed" "$out"
expect "switched off module" "module${TAB}c-mod${TAB}off${TAB}file${TAB}installed" "$out"
expect "winner" "result${TAB}used${TAB}a-mod" "$out"
out="$(wp /system/etc/hosts -P b-mod)"
expect "preferred module used" "result${TAB}used${TAB}b-mod" "$out"
out="$(wp //system//etc/hosts/)"
expect "path is normalized" "result${TAB}used${TAB}a-mod" "$out"
out="$(wp /system/etc)"
expect "folder merged" "module${TAB}a-mod${TAB}merged${TAB}folder${TAB}installed" "$out"
expect "folder result" "result${TAB}merged${TAB}-" "$out"
out="$(wp /vendor/etc/v)"
expect "vendor: KernelSU layout used" "module${TAB}d-mod${TAB}used${TAB}file${TAB}installed" "$out"
expect "vendor: plain layout ignored" "module${TAB}e-mod${TAB}ignored${TAB}file${TAB}installed" "$out"
n="$(printf '%s\n' "$out" | grep -c "^module${TAB}d-mod")"
[ "$n" = 1 ] && PASS=$((PASS + 1)) || { FAIL=$((FAIL + 1)); echo "FAIL [which] d-mod listed $n times"; }
out="$(wp /system/vendor/etc/v)"
expect "same place via /system/vendor" "result${TAB}used${TAB}d-mod" "$out"
out="$(wp /mi_ext/x)"
expect "partition not listed" "module${TAB}f-mod${TAB}unlisted${TAB}file${TAB}installed" "$out"
expect "nothing used" "result${TAB}none${TAB}-" "$out"
out="$(wp /system/bin/new)"
expect "pending update read" "module${TAB}g-mod${TAB}used${TAB}file${TAB}update" "$out"
out="$(wp /system/bin/nothing-here)"
reject "no module lines" "module${TAB}.*" "$out"
expect "none" "result${TAB}none${TAB}-" "$out"
out="$(wp ../etc/hosts)"; rc=$?
expect "relative path refused" "result${TAB}error${TAB}-" "$out"
[ "$rc" = 1 ] && PASS=$((PASS + 1)) || { FAIL=$((FAIL + 1)); echo "FAIL [which] exit code $rc"; }
out="$(wp /system/../etc)"
expect "dot-dot refused" "result${TAB}error${TAB}-" "$out"

echo "dryrun tests: $PASS passed, $FAIL failed"
[ "$FAIL" = 0 ]
