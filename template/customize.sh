#!/system/bin/sh

SKIPUNZIP=1

# Module configuration
module_id="meta-mm"
module_data_dir="/data/adb/magic_mount"
metamodule_link="/data/adb/metamodule"

ui_print "- Detecting root implementation"

if [ "x$KSU" = "xtrue" ] && [ "x$APATCH" = "xtrue" ]; then
    abort "! Both KernelSU and APatch detected - refusing to install"
elif [ "x$KSU" = "xtrue" ]; then
    AOK="KSU"
elif [ "x$APATCH" = "xtrue" ]; then
    AOK="APATCH"
else
    ui_print "! This is a metamodule for KernelSU / APatch only."
    ui_print "! Magisk and other root solutions are not supported."
    abort "! Unsupported root implementation"
fi
ui_print "  ✓ Root implementation: $AOK"

ui_print "- File integrity check"

# Extract all files to temporary directory
if ! unzip -o "${ZIPFILE}" -d "${TMPDIR}" >/dev/null 2>&1; then
    abort "! Failed to extract ZIP file"
fi

# Verify checksums
(
    cd "${TMPDIR}" || abort "! Failed to change directory to TMPDIR"
    
    if [ ! -f "checksums" ]; then
        abort "! checksums file not found in package"
    fi
    
    if sha256sum -c -s "checksums" >/dev/null 2>&1; then
        ui_print "  ✓ File integrity verification passed"
    else
        abort "! File integrity check failed - package may be corrupted"
    fi
) || abort "! Integrity check process failed"

ui_print "- Detecting device architecture..."

# Detect architecture using ro.product.cpu.abi
ABI=$(getprop ro.product.cpu.abi)

if [ -z "$ABI" ]; then
    abort "! Failed to detect device architecture"
fi

ui_print "  Detected ABI: $ABI"

# Select the correct binary based on architecture
case "$ABI" in
    arm64-v8a)
        ui_print "  ✓ Selected architecture: ARM64"
        ARCH_BINARY="mm_arm64"
        ;;
    armeabi-v7a)
        ui_print "  ✓ Selected architecture: ARMv7"
        ARCH_BINARY="mm_armv7"
        ;;
    x86_64)
        ui_print "  ✓ Selected architecture: x86_64"
        ARCH_BINARY="mm_amd64"
        ;;
    *)
        abort "! Unsupported architecture: $ABI"
        ;;
esac

ui_print "- Installing architecture-specific binary"

# Verify the selected binary exists
if [ ! -f "$TMPDIR/bin/$ARCH_BINARY" ]; then
    abort "! Binary not found: $ARCH_BINARY"
fi

# Ensure MODPATH exists
mkdir -p "$MODPATH" || abort "! Failed to create module directory"

# Install the binary
if ! cp "$TMPDIR/bin/$ARCH_BINARY" "$MODPATH/mmd"; then
    abort "! Failed to install binary"
fi

# Set executable permissions
if ! chmod 755 "$MODPATH/mmd"; then
    abort "! Failed to set binary permissions"
fi

ui_print "  ✓ Installed $ARCH_BINARY as mmd"

ui_print "- Configuring module properties"

# Modify module.prop with correct module ID and metamodule flag
if ! sed -i "s|^id=.*|id=$module_id|" "$TMPDIR/module.prop"; then
    abort "! Failed to set module ID"
fi

if ! sed -i "s|^metamodule=.*|metamodule=1|" "$TMPDIR/module.prop"; then
    abort "! Failed to set metamodule flag"
fi

ui_print "  ✓ Module ID: $module_id"

ui_print "- Installing module files"

# Define files to install
module_files="
    module.prop
"

# Scripts that need executable permissions
executable_scripts="
    metainstall.sh
    metauninstall.sh
    metamount.sh
    service.sh
    uninstall.sh
"

# Directories to copy recursively
module_dirs="
    webroot
"

# Copy regular module files
for f in ${module_files}; do
    if [ ! -f "$TMPDIR/$f" ]; then
        ui_print "  ! Warning: $f not found, skipping"
        continue
    fi
    
    if ! cp "$TMPDIR/$f" "$MODPATH/$f"; then
        abort "! Failed to copy $f"
    fi
    
    chmod 0644 "$MODPATH/$f" || abort "! Failed to set permissions for $f"
    ui_print "  ✓ Installed: $f"
done

# Copy executable scripts
for f in ${executable_scripts}; do
    if [ ! -f "$TMPDIR/$f" ]; then
        ui_print "  ! Warning: $f not found, skipping"
        continue
    fi
    
    if ! cp "$TMPDIR/$f" "$MODPATH/$f"; then
        abort "! Failed to copy $f"
    fi
    
    chmod 0755 "$MODPATH/$f" || abort "! Failed to set permissions for $f"
    ui_print "  ✓ Installed: $f (executable)"
done

# Copy directories
for d in ${module_dirs}; do
    if [ ! -d "$TMPDIR/$d" ]; then
        ui_print "  ! Warning: $d not found, skipping"
        continue
    fi
    
    if ! cp -r "$TMPDIR/$d" "$MODPATH/"; then
        abort "! Failed to copy directory $d"
    fi
    
    ui_print "  ✓ Installed: $d/"
done


# Record root implementation for metamount.sh and the WebUI
if ! echo "AOK=$AOK" > "$MODPATH/aok"; then
    abort "! Failed to write root implementation marker"
fi
chmod 0644 "$MODPATH/aok"

ui_print "- Initializing configuration"

# Create data directory
if ! mkdir -p "$module_data_dir"; then
    abort "! Failed to create data directory"
fi

# Install default configuration only if it doesn't exist
if [ ! -f "$module_data_dir/mm.conf" ]; then
    if [ -f "$TMPDIR/mm.conf" ]; then
        if ! cp "$TMPDIR/mm.conf" "$module_data_dir/mm.conf"; then
            abort "! Failed to install default configuration"
        fi
        chmod 0644 "$module_data_dir/mm.conf"
        ui_print "  ✓ Installed default configuration"
    else
        ui_print "  ! Warning: Default config not found"
    fi
else
    ui_print "  ℹ Existing configuration preserved"
fi

# List of modules whose mounting was switched off in the WebUI.
# metamount.sh re-applies it after module updates, uninstall.sh uses it
# to undo exactly those changes.
skip_list="$module_data_dir/skip_mount.list"
[ -f "$skip_list" ] || : > "$skip_list"
chmod 0644 "$skip_list"

# skip_mount files that are not on the list were created by the module
# itself or by an older WebUI. They are left alone; show them so nothing
# is silently off.
untracked=""
for m in /data/adb/modules/*; do
    [ -e "$m/skip_mount" ] || continue
    id="${m##*/}"
    [ "$id" = "$module_id" ] && continue
    grep -qxF "$id" "$skip_list" 2>/dev/null || untracked="$untracked $id"
done
if [ -n "$untracked" ]; then
    ui_print "  ℹ Mounting is off (skip_mount) for:$untracked"
    ui_print "    Switch it on in the WebUI if that was not intended."
fi

# Try-umount relies on a KernelSU ioctl; it is meaningless on APatch
if [ "$AOK" = "APATCH" ] && [ -f "$module_data_dir/mm.conf" ]; then
    sed -i '/^[[:space:]]*umount[[:space:]]*=/d' "$module_data_dir/mm.conf"
fi

ui_print "- Managing metamodule status"

# module.prop in the zip says metamodule=0 on purpose: ksud then installs
# this zip like a regular module, which lets it replace another metamodule.
# The flag is set to 1 above for the installed copy, so ksud treats the
# installed module as the metamodule. Because ksud only manages the
# /data/adb/metamodule link for zips marked metamodule=1, the link is
# handled here.

# Check if metamodule symlink exists and points to a different module
if [ -L "$metamodule_link" ]; then
    metamodule_path=$(realpath "$metamodule_link" 2>/dev/null)
    
    if [ -n "$metamodule_path" ]; then
        metamodule_id=$(basename "$metamodule_path")
        
        if [ "$metamodule_id" != "$module_id" ]; then
            ui_print "  Switching from $metamodule_id to $module_id"
            
            # Mark old metamodule for removal
            if [ -f "$metamodule_path/module.prop" ]; then
                touch "$metamodule_path/remove" 2>/dev/null
                sed -i "s|^metamodule=.*|metamodule=0|" "$metamodule_path/module.prop" 2>/dev/null
            fi
            
            # Remove old symlink
            rm -f "$metamodule_link"
        else
            ui_print "  ✓ Already active metamodule"
        fi
    fi
elif [ -e "$metamodule_link" ]; then
    # If it exists but is not a symlink, remove it
    ui_print "  Cleaning up invalid metamodule link"
    rm -rf "$metamodule_link"
fi

# Create new metamodule symlink if needed
if [ ! -e "$metamodule_link" ]; then
    if ln -sf "/data/adb/modules/$module_id" "$metamodule_link"; then
        ui_print "  ✓ Activated as metamodule"
    else
        ui_print "  ! Warning: Failed to create metamodule link"
    fi
fi

ui_print "- Checking for other mount modules"

# Only one module may mount other modules' files. A second one (another
# metamodule left behind, or a standalone mounter such as mountify) would
# mount the same files again on top of these mounts.
others=""
for m in /data/adb/modules/* /data/adb/modules_update/*; do
    [ -f "$m/module.prop" ] || continue
    id="${m##*/}"
    [ "$id" = "$module_id" ] && continue
    [ -e "/data/adb/modules/$id/remove" ] && continue
    case " $others " in *" $id "*) continue ;; esac
    if grep -qiE '^metamodule=(1|true)[[:space:]]*$' "$m/module.prop"; then
        others="$others $id"
    else
        case "$id" in
            mountify) others="$others $id" ;;
        esac
    fi
done
if [ -n "$others" ]; then
    ui_print "  ! Other modules that mount module files:$others"
    ui_print "    Remove them, or both will mount the same files."
else
    ui_print "  ✓ None found"
fi

ui_print "- Finalizing installation"

ui_print ""
ui_print "========================================="
ui_print " Magic Mount Installation Information"
ui_print "========================================="
ui_print " Module ID: $module_id"
ui_print " Root: $AOK"
ui_print " Architecture: $ABI"
ui_print " Binary: $ARCH_BINARY"
ui_print " Data directory: $module_data_dir"
ui_print "========================================="
ui_print ""
