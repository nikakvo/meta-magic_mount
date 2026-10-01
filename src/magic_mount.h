#ifndef MAGIC_MOUNT_H
#define MAGIC_MOUNT_H

#include <stdbool.h>
#include <stddef.h>

#define DISABLE_FILE_NAME "disable"
#define REMOVE_FILE_NAME "remove"
#define SKIP_MOUNT_FILE_NAME "skip_mount"
#define UPDATE_FILE_NAME "update"

#define REPLACE_DIR_XATTR "trusted.overlay.opaque"
#define REPLACE_DIR_FILE_NAME ".replace"

#define DEFAULT_MOUNT_SOURCE "KSU"
#define DEFAULT_MODULE_DIR "/data/adb/modules"

/* Mount statistics */
typedef struct {
    int modules_total;
    int nodes_total;
    int nodes_mounted;
    int nodes_skipped;
    int nodes_whiteout;
    int nodes_fail;
} MountStats;

/* An enabled module, in the order its files are applied */
typedef struct {
    char *id;
    char *path;   /* folder the files are read from */
    bool pending; /* path is a not yet applied update (dry run only) */
} ModuleEntry;

/* Two modules want the same path. The module that comes first in the
 * mount order wins (preferred modules first, then by id). */
typedef enum {
    CONFLICT_FILE,    /* both ship the entry, different content: winner used */
    CONFLICT_SAME,    /* both ship identical content: no visible effect */
    CONFLICT_TYPE,    /* file vs folder vs link vs removal: winner used */
    CONFLICT_REPLACE, /* winner empties a folder the other one adds to */
} ConflictKind;

typedef struct {
    ConflictKind kind;
    char *path; /* inside the module, e.g. system/etc/hosts */
    char *winner;
    char *loser;
} Conflict;

/* Core ctx */
typedef struct MagicMount {
    const char *module_dir;
    const char *mount_source;

    MountStats stats;

    char **failed_modules;
    int failed_modules_count;

    char **extra_parts;
    int extra_parts_count;

    /* Module ids that win conflicts, most preferred first */
    char **priority;
    int priority_count;

    ModuleEntry *modules;
    int modules_count;

    Conflict *conflicts;
    int conflicts_count;

    bool enable_unmountable;
    /* Read installed-but-not-applied updates (modules_update/) instead of
     * the current files, to show what the next boot will do. */
    bool use_pending_updates;
    /* Set when the mount tree could not be built (not: nothing to mount) */
    bool tree_error;
} MagicMount;

/* Initialization ctx (module_dir/mount_source) */
void magic_mount_init(MagicMount *ctx);

/* Main func */
int magic_mount(MagicMount *ctx, const char *tmp_root);

/* (failure module / extra_parts / modules / conflicts) */
void magic_mount_cleanup(MagicMount *ctx);

const char *conflict_kind_name(ConflictKind k);

#endif /* MAGIC_MOUNT_H */
