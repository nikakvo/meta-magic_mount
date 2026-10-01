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

/* (extra_parts / failed_modules / priority / modules / conflicts) */
void module_tree_cleanup(MagicMount *ctx);

#endif /* MODULE_TREE_H */
