#ifndef MODULE_TREE_H
#define MODULE_TREE_H

#include "magic_mount.h"
#include <stdbool.h>
#include <stddef.h>
#include <sys/stat.h>

/* Node Type */
typedef enum { NFT_REGULAR, NFT_DIRECTORY, NFT_SYMLINK, NFT_WHITEOUT } NodeFileType;

/* Node */
typedef struct Node {
    char *name;
    NodeFileType type;
    struct Node **children;
    size_t child_count;
    char *module_path;
    char *module_name;
    bool replace;
    bool skip;
    bool done;
} Node;

/* Node utils func */
NodeFileType node_type_from_stat(const struct stat *st);
Node *node_child_find(Node *parent, const char *name);
void node_free(Node *n);

/* Enabled modules in mount order -> ctx->modules. Returns -1 on error. */
int module_list_collect(MagicMount *ctx);

/* Build the tree of everything to mount from ctx->modules.
 * Returns NULL when there is nothing to mount, or on error; errors also set
 * ctx->tree_error. Conflicts between modules go to ctx->conflicts. */
Node *build_mount_tree(MagicMount *ctx);

/* ctx->extra_parts */
void extra_partition_register(MagicMount *ctx, const char *start, size_t len);

/* ctx->priority */
void priority_register(MagicMount *ctx, const char *start, size_t len);

/* ctx->failed_modules */
void module_mark_failed(MagicMount *ctx, const char *module_name);

/* Report every top-level folder of an enabled module that matches a
 * partition mounted at /<name> (ext4 / erofs / f2fs, read from `mountinfo`)
 * but is neither built in nor listed in partitions=, so it is not mounted.
 * Only for --dry-run; never changes what gets mounted. Returns the count. */
typedef void (*unlisted_fn)(const char *partition, const char *module_id, void *arg);
int unlisted_partitions_report(const MagicMount *ctx, const char *mountinfo, unlisted_fn fn,
                               void *arg);

/* Every installed module that ships `path` (an absolute device path such
 * as /system/bin/ipset), with what the next boot does with it:
 *   used / ignored (lost a conflict) / merged (folder) / off (module
 *   switched off) / unlisted (partition not in partitions=) / not-mounted.
 * *winner is the module whose file is used, "" for a merged folder, NULL
 * when none. Read only, like --dry-run. Returns the count, -1 on error. */
typedef void (*which_fn)(const char *module_id, const char *status, NodeFileType type,
                         bool pending, void *arg);
int which_report(MagicMount *ctx, const char *path, which_fn fn, void *arg, const char **winner);

/* (extra_parts / failed_modules / priority / modules / conflicts) */
void module_tree_cleanup(MagicMount *ctx);

#endif /* MODULE_TREE_H */
