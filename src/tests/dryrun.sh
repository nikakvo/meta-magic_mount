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

echo "dryrun tests: $PASS passed, $FAIL failed"
[ "$FAIL" = 0 ]
