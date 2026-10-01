#include "module_tree.h"
#include "magic_mount.h"
#include "utils.h"

#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <sys/xattr.h>
#include <unistd.h>

/* --- Node basic mgr --- */

static Node *node_new(const char *name, NodeFileType t) {
    Node *n = calloc(1, sizeof(Node));
    if (!n)
        return NULL;

    n->name = strdup(name ? name : "");
    n->type = t;
    return n;
}

void node_free(Node *n) {
    if (!n)
        return;

    for (size_t i = 0; i < n->child_count; ++i)
        node_free(n->children[i]);

    free(n->children);
    free(n->name);
    free(n->module_path);
    free(n->module_name);
    free(n);
}

NodeFileType node_type_from_stat(const struct stat *st) {
    if (S_ISCHR(st->st_mode) && st->st_rdev == 0)
        return NFT_WHITEOUT;
    if (S_ISREG(st->st_mode))
        return NFT_REGULAR;
    if (S_ISDIR(st->st_mode))
        return NFT_DIRECTORY;
    if (S_ISLNK(st->st_mode))
        return NFT_SYMLINK;
    return NFT_WHITEOUT;
}

static bool dir_is_replace(const char *path) {
    char buf[8];
    ssize_t len = lgetxattr(path, REPLACE_DIR_XATTR, buf, sizeof(buf) - 1);

    if (len > 0) {
        buf[len] = '\0';
        if (strcmp(buf, "y") == 0)
            return true;
    }

    int dirfd = open(path, O_RDONLY | O_DIRECTORY);
    if (dirfd < 0)
        return false;

    bool exists = (faccessat(dirfd, REPLACE_DIR_FILE_NAME, F_OK, 0) == 0);
    close(dirfd);
    return exists;
}

static int node_child_append(Node *parent, Node *child) {
    if (!parent || !child) {
        LOGE("node_child_append: parent or child is NULL");
        errno = EINVAL;
        return -1;
    }

    LOGD("node_child_append: parent='%s' add child='%s'", parent->name ? parent->name : "(root)",
         child->name ? child->name : "(null)");

    Node **arr = realloc(parent->children, (parent->child_count + 1) * sizeof(Node *));
    if (!arr) {
        LOGE("node_child_append: realloc failed (parent='%s', child='%s')",
             parent->name ? parent->name : "(root)", child->name ? child->name : "(null)");
        errno = ENOMEM;
        return -1;
    }

    parent->children = arr;
    parent->children[parent->child_count++] = child;
    return 0;
}

Node *node_child_find(Node *parent, const char *name) {
    for (size_t i = 0; i < parent->child_count; ++i) {
        if (strcmp(parent->children[i]->name, name) == 0)
            return parent->children[i];
    }
    return NULL;
}

static Node *node_child_detach(Node *parent, const char *name) {
    for (size_t i = 0; i < parent->child_count; ++i) {
        if (strcmp(parent->children[i]->name, name) == 0) {
            Node *n = parent->children[i];
            memmove(&parent->children[i], &parent->children[i + 1],
                    (parent->child_count - i - 1) * sizeof(Node *));
            parent->child_count--;
            return n;
        }
    }
    return NULL;
}

void module_mark_failed(MagicMount *ctx, const char *module_name) {
    if (!ctx || !module_name)
        return;

    // Check for duplicates
    for (int i = 0; i < ctx->failed_modules_count; ++i) {
        if (strcmp(ctx->failed_modules[i], module_name) == 0)
            return;
    }

    if (!str_array_append(&ctx->failed_modules, &ctx->failed_modules_count, module_name)) {
        LOGW("failed to record module failure for %s (OOM)", module_name);
    }
}

/* --- Extra partition blacklist --- */

static bool extra_part_blacklisted(const char *name) {
    if (!name || !*name)
        return false;

    while (*name == '/')
        name++;

    char buf[16];
    size_t i = 0;
    while (name[i] != '\0' && name[i] != '/' && i + 1 < sizeof(buf)) {
        buf[i] = name[i];
        i++;
    }
    buf[i] = '\0';

    static const char *blacklist[] = {
        "bin", "etc",  "data", "data_mirror", "sdcard",  "tmp",    "dev",        "sys",
        "mnt", "proc", "d",    "test",        "product", "vendor", "system_ext", "odm"};
    size_t n = sizeof(blacklist) / sizeof(blacklist[0]);

    for (size_t j = 0; j < n; ++j) {
        if (strcmp(buf, blacklist[j]) == 0)
            return true;
    }
    return false;
}

void extra_partition_register(MagicMount *ctx, const char *start, size_t len) {
    if (!ctx) {
        LOGE("extra_partition_register: NULL context");
        return;
    }

    if (!start || len == 0) {
        LOGW("extra_partition_register: invalid input (start=%p, len=%zu)", (void *)start, len);
        return;
    }

    char *buf = malloc(len + 1);
    if (!buf) {
        LOGE("extra_partition_register: malloc failed for %zu bytes", len + 1);
        return;
    }

    memcpy(buf, start, len);
    buf[len] = '\0';

    LOGD("extra_partition_register: processing '%s' (len=%zu)", buf, len);

    size_t original_len = strlen(buf);
    str_trim(buf);
    size_t trimmed_len = strlen(buf);

    if (original_len != trimmed_len) {
        LOGD("extra_partition_register: trimmed whitespace (%zu -> %zu bytes)", original_len,
             trimmed_len);
    }

    if (buf[0] == '\0') {
        LOGW("extra_partition_register: rejected empty string after trim");
        free(buf);
        return;
    }

    if (extra_part_blacklisted(buf)) {
        LOGW("extra_partition_register: rejected '%s' (blacklisted)", buf);
        free(buf);
        return;
    }

    if (!str_array_append(&ctx->extra_parts, &ctx->extra_parts_count, buf)) {
        LOGE("extra_partition_register: failed to add '%s' (OOM or array error, count=%d)", buf,
             ctx->extra_parts_count);
        free(buf);
        return;
    }

    LOGI("extra_partition_register: success added '%s' (total: %d partitions)", buf,
         ctx->extra_parts_count);

    free(buf);
}

/* --- Mount order: preferred modules --- */

void priority_register(MagicMount *ctx, const char *start, size_t len) {
    if (!ctx || !start || len == 0)
        return;

    char id[256];
    if (len >= sizeof(id)) {
        LOGW("priority: module id too long, ignored");
        return;
    }
    memcpy(id, start, len);
    id[len] = '\0';
    str_trim(id);

    if (id[0] == '\0' || !strcmp(id, ".") || !strcmp(id, "..") || strchr(id, '/')) {
        LOGW("priority: invalid module id '%s', ignored", id);
        return;
    }

    for (int i = 0; i < ctx->priority_count; ++i) {
        if (!strcmp(ctx->priority[i], id))
            return;
    }

    if (!str_array_append(&ctx->priority, &ctx->priority_count, id))
        LOGE("priority: failed to add '%s' (OOM)", id);
}

static int priority_rank(const MagicMount *ctx, const char *id) {
    for (int i = 0; i < ctx->priority_count; ++i) {
        if (!strcmp(ctx->priority[i], id))
            return i;
    }
    return ctx->priority_count;
}

/* --- Module list --- */

static bool module_has_flag(const char *mod_dir, const char *flag) {
    char buf[PATH_MAX];
    return path_join(mod_dir, flag, buf, sizeof(buf)) == 0 && path_exists(buf);
}

static bool module_is_disabled(const char *mod_dir) {
    return module_has_flag(mod_dir, DISABLE_FILE_NAME) ||
           module_has_flag(mod_dir, REMOVE_FILE_NAME) ||
           module_has_flag(mod_dir, SKIP_MOUNT_FILE_NAME);
}

/* "/data/adb/modules" -> "/data/adb/modules_update" */
static int update_dir_for(const char *module_dir, char *out, size_t n) {
    char tmp[PATH_MAX];
    if (snprintf(tmp, sizeof(tmp), "%s", module_dir) >= (int)sizeof(tmp))
        return -1;
    size_t len = strlen(tmp);
    while (len > 1 && tmp[len - 1] == '/')
        tmp[--len] = '\0';
    if (snprintf(out, n, "%s_update", tmp) >= (int)n)
        return -1;
    return 0;
}

typedef struct {
    ModuleEntry e;
    int rank;
} RankedModule;

static int ranked_cmp(const void *a, const void *b) {
    const RankedModule *x = a, *y = b;
    if (x->rank != y->rank)
        return x->rank < y->rank ? -1 : 1;
    return strcmp(x->e.id, y->e.id);
}

int module_list_collect(MagicMount *ctx) {
    const char *mdir = ctx->module_dir ? ctx->module_dir : DEFAULT_MODULE_DIR;
    char upd_root[PATH_MAX] = {0};

    if (ctx->use_pending_updates && update_dir_for(mdir, upd_root, sizeof(upd_root)) != 0)
        upd_root[0] = '\0';

    DIR *d = opendir(mdir);
    if (!d) {
        LOGE("opendir %s: %s", mdir, strerror(errno));
        return -1;
    }

    RankedModule *list = NULL;
    size_t count = 0, cap = 0;
    struct dirent *de;
    int rc = 0;

    while ((de = readdir(d))) {
        if (de->d_name[0] == '.')
            continue;

        char mod[PATH_MAX];
        if (path_join(mdir, de->d_name, mod, sizeof(mod)) != 0 || !path_is_dir(mod))
            continue;

        if (module_is_disabled(mod)) {
            LOGI("module %s is disabled or not mounted, skip", de->d_name);
            continue;
        }

        const char *src = mod;
        char upd[PATH_MAX];
        bool pending = false;

        if (upd_root[0] && module_has_flag(mod, UPDATE_FILE_NAME) &&
            path_join(upd_root, de->d_name, upd, sizeof(upd)) == 0 && path_is_dir(upd)) {
            if (module_has_flag(upd, SKIP_MOUNT_FILE_NAME) ||
                module_has_flag(upd, DISABLE_FILE_NAME)) {
                LOGI("module %s: pending update is not mounted, skip", de->d_name);
                continue;
            }
            src = upd;
            pending = true;
        }

        if (count == cap) {
            size_t ncap = cap ? cap * 2 : 32;
            RankedModule *nl = realloc(list, ncap * sizeof(*nl));
            if (!nl) {
                rc = -1;
                break;
            }
            list = nl;
            cap = ncap;
        }

        RankedModule *r = &list[count];
        r->e.id = strdup(de->d_name);
        r->e.path = strdup(src);
        r->e.pending = pending;
        r->rank = priority_rank(ctx, de->d_name);
        if (!r->e.id || !r->e.path) {
            free(r->e.id);
            free(r->e.path);
            rc = -1;
            break;
        }
        count++;
    }
    closedir(d);

    if (rc != 0) {
        LOGE("module_list_collect: out of memory");
        for (size_t i = 0; i < count; ++i) {
            free(list[i].e.id);
            free(list[i].e.path);
        }
        free(list);
        return -1;
    }

    /* readdir order depends on the filesystem; sort, so which module wins a
     * conflict is stable across boots and reinstalls */
    if (count > 1)
        qsort(list, count, sizeof(*list), ranked_cmp);

    ctx->modules = calloc(count ? count : 1, sizeof(ModuleEntry));
    if (!ctx->modules) {
        for (size_t i = 0; i < count; ++i) {
            free(list[i].e.id);
            free(list[i].e.path);
        }
        free(list);
        return -1;
    }
    for (size_t i = 0; i < count; ++i)
        ctx->modules[i] = list[i].e;
    ctx->modules_count = (int)count;
    free(list);

    for (int i = 0; i < ctx->modules_count; ++i) {
        LOGD("mount order %d: %s%s", i + 1, ctx->modules[i].id,
             ctx->modules[i].pending ? " (pending update)" : "");
    }
    return 0;
}

/* --- Conflicts --- */

const char *conflict_kind_name(ConflictKind k) {
    switch (k) {
    case CONFLICT_FILE:
        return "file";
    case CONFLICT_SAME:
        return "same";
    case CONFLICT_TYPE:
        return "type";
    case CONFLICT_REPLACE:
        return "replace";
    }
    return "?";
}

static void conflict_add(MagicMount *ctx, ConflictKind kind, const char *path, const char *winner,
                         const char *loser) {
    if (!winner || !loser || !strcmp(winner, loser))
        return;

    if (kind == CONFLICT_SAME)
        LOGI("same file in %s and %s: %s", winner, loser, path);
    else if (kind == CONFLICT_REPLACE)
        LOGW("conflict: %s replaces folder %s, which %s also changes", winner, path, loser);
    else
        LOGW("conflict: %s: %s is used, %s is ignored (%s)", path, winner, loser,
             conflict_kind_name(kind));

    Conflict *arr = realloc(ctx->conflicts, (size_t)(ctx->conflicts_count + 1) * sizeof(Conflict));
    if (!arr) {
        LOGW("conflict_add: out of memory");
        return;
    }
    ctx->conflicts = arr;

    Conflict *c = &ctx->conflicts[ctx->conflicts_count];
    c->kind = kind;
    c->path = strdup(path);
    c->winner = strdup(winner);
    c->loser = strdup(loser);
    if (!c->path || !c->winner || !c->loser) {
        free(c->path);
        free(c->winner);
        free(c->loser);
        return;
    }
    ctx->conflicts_count++;
}

static bool files_equal(const char *a, const char *b) {
    int fa = open(a, O_RDONLY | O_CLOEXEC);
    if (fa < 0)
        return false;
    int fb = open(b, O_RDONLY | O_CLOEXEC);
    if (fb < 0) {
        close(fa);
        return false;
    }

    bool eq = false;
    struct stat sa, sb;
    if (fstat(fa, &sa) == 0 && fstat(fb, &sb) == 0 && sa.st_size == sb.st_size) {
        static char ba[16384], bb[16384];
        eq = true;
        for (;;) {
            ssize_t ra = read(fa, ba, sizeof(ba));
            if (ra <= 0) {
                eq = (ra == 0);
                break;
            }
            ssize_t got = 0;
            while (got < ra) {
                ssize_t rb = read(fb, bb + got, (size_t)(ra - got));
                if (rb <= 0)
                    break;
                got += rb;
            }
            if (got != ra || memcmp(ba, bb, (size_t)ra) != 0) {
                eq = false;
                break;
            }
        }
    }

    close(fa);
    close(fb);
    return eq;
}

static bool links_equal(const char *a, const char *b) {
    char ta[PATH_MAX], tb[PATH_MAX];
    ssize_t la = readlink(a, ta, sizeof(ta) - 1);
    ssize_t lb = readlink(b, tb, sizeof(tb) - 1);
    if (la < 0 || lb < 0 || la != lb)
        return false;
    return memcmp(ta, tb, (size_t)la) == 0;
}

/* --- Partition links inside a module --- */

static const char *const BUILTIN_PARTS[] = {"vendor", "system_ext", "product", "odm"};
#define BUILTIN_PARTS_COUNT (sizeof(BUILTIN_PARTS) / sizeof(BUILTIN_PARTS[0]))

static bool is_builtin_part(const char *name) {
    for (size_t i = 0; i < BUILTIN_PARTS_COUNT; ++i) {
        if (!strcmp(name, BUILTIN_PARTS[i]))
            return true;
    }
    return false;
}

static bool is_extra_part(const MagicMount *ctx, const char *name) {
    for (int i = 0; i < ctx->extra_parts_count; ++i) {
        if (!strcmp(name, ctx->extra_parts[i]))
            return true;
    }
    return false;
}

/* KernelSU's default installer moves system/<part> to <part> and leaves a
 * link system/<part> -> ../<part>. True when `link` is such a link of module
 * `mod_root` (relative, or absolute to the module folder). */
static bool is_partition_link(const MagicMount *ctx, const char *link, const char *mod_root,
                              const char *module_id, const char *part) {
    char target[PATH_MAX];
    ssize_t len = readlink(link, target, sizeof(target) - 1);
    if (len <= 0)
        return false;
    while (len > 1 && target[len - 1] == '/')
        len--;
    target[len] = '\0';

    char expect[PATH_MAX];
    if (snprintf(expect, sizeof(expect), "../%s", part) < (int)sizeof(expect) &&
        !strcmp(target, expect))
        return true;
    if (path_join(mod_root, part, expect, sizeof(expect)) == 0 && !strcmp(target, expect))
        return true;

    char tmp[PATH_MAX];
    const char *mdir = ctx->module_dir ? ctx->module_dir : DEFAULT_MODULE_DIR;
    if (path_join(mdir, module_id, tmp, sizeof(tmp)) == 0 &&
        path_join(tmp, part, expect, sizeof(expect)) == 0 && !strcmp(target, expect))
        return true;

    return false;
}

/* --- Node collect --- */

/* Merge the folder `dir` of module `m` into `self`. `rel` is the folder's
 * path inside the module (for messages). At the "system" level, partition
 * links (system/vendor -> ../vendor) are followed, so every module's vendor
 * files end up in the same place whichever layout it was installed with. */
static int node_scan_dir(MagicMount *ctx, Node *self, const char *dir, const ModuleEntry *m,
                         const char *rel, bool *has_any) {
    DIR *d = opendir(dir);
    if (!d) {
        LOGE("opendir %s: %s", dir, strerror(errno));
        return -1;
    }

    bool at_system = !strcmp(rel, "system");
    struct dirent *de;
    bool any = false;
    char path[PATH_MAX], crel[PATH_MAX];

    while ((de = readdir(d))) {
        if (!strcmp(de->d_name, ".") || !strcmp(de->d_name, ".."))
            continue;

        if (path_join(dir, de->d_name, path, sizeof(path)) != 0 ||
            path_join(rel, de->d_name, crel, sizeof(crel)) != 0) {
            LOGE("node_scan_dir: path too long in %s", dir);
            closedir(d);
            return -1;
        }

        struct stat st;
        if (lstat(path, &st) < 0) {
            LOGW("lstat %s: %s", path, strerror(errno));
            continue;
        }

        if (at_system && S_ISLNK(st.st_mode)) {
            bool builtin = is_builtin_part(de->d_name);
            if ((builtin || is_extra_part(ctx, de->d_name)) &&
                is_partition_link(ctx, path, m->path, m->id, de->d_name)) {
                if (!builtin) {
                    /* extra partitions are collected from <module>/<part> */
                    LOGD("skip partition link %s (collected as /%s)", crel, de->d_name);
                    continue;
                }
                char real[PATH_MAX];
                if (path_join(m->path, de->d_name, real, sizeof(real)) == 0 && path_is_dir(real)) {
                    LOGD("follow partition link %s -> %s", crel, real);
                    snprintf(path, sizeof(path), "%s", real);
                    if (lstat(path, &st) < 0)
                        continue;
                }
            }
        }

        if (!(S_ISCHR(st.st_mode) || S_ISREG(st.st_mode) || S_ISDIR(st.st_mode) ||
              S_ISLNK(st.st_mode))) {
            LOGD("skip unsupported file type %s (mode=%o)", path, st.st_mode);
            continue;
        }

        NodeFileType nt = node_type_from_stat(&st);
        Node *child = node_child_find(self, de->d_name);

        if (!child) {
            child = node_new(de->d_name, nt);
            if (!child) {
                LOGE("node_scan_dir: out of memory");
                closedir(d);
                return -1;
            }
            child->module_path = strdup(path);
            child->module_name = strdup(m->id);
            child->replace = (nt == NFT_DIRECTORY) && dir_is_replace(path);
            if (!child->module_path || !child->module_name || node_child_append(self, child) != 0) {
                node_free(child);
                closedir(d);
                return -1;
            }
            ctx->stats.nodes_total++;
        } else if (child->type != NFT_DIRECTORY || nt != NFT_DIRECTORY) {
            /* Already provided by a module earlier in the mount order */
            ConflictKind kind = CONFLICT_FILE;
            if (child->type != nt)
                kind = CONFLICT_TYPE;
            else if (nt == NFT_WHITEOUT)
                kind = CONFLICT_SAME;
            else if (nt == NFT_REGULAR && files_equal(child->module_path, path))
                kind = CONFLICT_SAME;
            else if (nt == NFT_SYMLINK && links_equal(child->module_path, path))
                kind = CONFLICT_SAME;
            conflict_add(ctx, kind, crel, child->module_name, m->id);
            any = true;
            continue;
        } else if (!child->replace && dir_is_replace(path)) {
            /* Any module may empty a folder, whatever the order */
            child->replace = true;
            conflict_add(ctx, CONFLICT_REPLACE, crel, m->id, child->module_name);
        }

        if (child->type == NFT_DIRECTORY) {
            bool sub = false;
            if (node_scan_dir(ctx, child, path, m, crel, &sub) != 0) {
                closedir(d);
                return -1;
            }
            if (sub || child->replace)
                any = true;
        } else {
            any = true;
        }
    }

    closedir(d);
    *has_any = any;
    return 0;
}

/* --- Extra partition collect --- */

/* 0 = content found, 1 = nothing, -1 = error */
static int partition_scan_from_modules(MagicMount *ctx, const char *part_name, Node *parent_node) {
    bool has_any = false;

    for (int i = 0; i < ctx->modules_count; ++i) {
        const ModuleEntry *m = &ctx->modules[i];
        char part_path[PATH_MAX];

        if (path_join(m->path, part_name, part_path, sizeof(part_path)) != 0)
            continue;
        if (!path_is_dir(part_path) || path_is_symlink(part_path))
            continue;

        LOGD("collecting /%s from module %s", part_name, m->id);

        bool sub = false;
        if (node_scan_dir(ctx, parent_node, part_path, m, part_name, &sub) != 0) {
            LOGE("collecting /%s from module %s failed", part_name, m->id);
            return -1;
        }
        if (sub)
            has_any = true;
    }

    return has_any ? 0 : 1;
}

/* --- Helper for partition promotion --- */

static int partition_promote_to_root(Node *root, Node *system, const char *part_name,
                                     bool need_symlink) {
    char rp[PATH_MAX], sp[PATH_MAX];

    if (path_join("/", part_name, rp, sizeof(rp)) != 0 ||
        path_join("/system", part_name, sp, sizeof(sp)) != 0)
        return -1;

    if (!path_is_dir(rp)) {
        LOGD("partition_promote_to_root: skip %s (real path %s not a dir)", part_name, rp);
        return 0;
    }

    if (need_symlink && !path_is_symlink(sp)) {
        LOGD("partition_promote_to_root: skip %s (no symlink at %s)", part_name, sp);
        return 0;
    }

    Node *child = node_child_detach(system, part_name);
    if (!child)
        return 0;

    LOGD("partition_promote_to_root: promoting '%s' from /system to /", part_name);

    if (node_child_append(root, child) != 0) {
        LOGE("partition_promote_to_root: failed to attach '%s' to root", part_name);
        node_free(child);
        return -1;
    }

    return 0;
}

/* --- Root collection --- */

static Node *tree_fail(MagicMount *ctx, Node *root, Node *system) {
    ctx->tree_error = true;
    node_free(root);
    node_free(system);
    return NULL;
}

Node *build_mount_tree(MagicMount *ctx) {
    if (!ctx)
        return NULL;

    ctx->tree_error = false;
    LOGI("build_mount_tree: module_dir=%s", ctx->module_dir);

    if (!ctx->modules && module_list_collect(ctx) != 0) {
        ctx->tree_error = true;
        return NULL;
    }

    Node *root = node_new("", NFT_DIRECTORY);
    Node *system = node_new("system", NFT_DIRECTORY);
    if (!root || !system) {
        LOGE("build_mount_tree: failed to allocate root/system nodes");
        return tree_fail(ctx, root, system);
    }

    bool has_any = false;

    for (int i = 0; i < ctx->modules_count; ++i) {
        const ModuleEntry *m = &ctx->modules[i];
        char mod_sys[PATH_MAX];

        if (path_join(m->path, "system", mod_sys, sizeof(mod_sys)) != 0)
            continue;
        if (!path_is_dir(mod_sys))
            continue;

        LOGI("build_mount_tree: collecting module %s", m->id);
        ctx->stats.modules_total++;

        bool sub = false;
        if (node_scan_dir(ctx, system, mod_sys, m, "system", &sub) != 0) {
            /* One unreadable module must not stop the others */
            LOGE("build_mount_tree: could not read module %s, it is not mounted", m->id);
            module_mark_failed(ctx, m->id);
            continue;
        }
        if (sub)
            has_any = true;
    }

    // Promote builtin partitions to root
    struct {
        const char *name;
        bool need_symlink;
    } builtin_parts[] = {
        {"vendor", true},
        {"system_ext", true},
        {"product", true},
        {"odm", false},
    };

    for (size_t i = 0; i < sizeof(builtin_parts) / sizeof(builtin_parts[0]); ++i) {
        if (partition_promote_to_root(root, system, builtin_parts[i].name,
                                      builtin_parts[i].need_symlink) != 0)
            return tree_fail(ctx, root, system);
    }

    // Handle extra partitions
    for (int i = 0; i < ctx->extra_parts_count; ++i) {
        const char *name = ctx->extra_parts[i];
        char rp[PATH_MAX];

        if (path_join("/", name, rp, sizeof(rp)) != 0)
            continue;

        if (!path_is_dir(rp)) {
            LOGD("build_mount_tree: extra partition '%s' skipped, %s is not a dir", name, rp);
            continue;
        }

        Node *child = node_new(name, NFT_DIRECTORY);
        if (!child)
            return tree_fail(ctx, root, system);

        int ret = partition_scan_from_modules(ctx, name, child);
        if (ret == 0) {
            LOGI("build_mount_tree: collected extra partition '%s'", name);
            if (node_child_append(root, child) != 0) {
                node_free(child);
                return tree_fail(ctx, root, system);
            }
            has_any = true;
        } else {
            node_free(child);
            if (ret < 0)
                return tree_fail(ctx, root, system);
        }
    }

    if (!has_any) {
        LOGI("build_mount_tree: no module ships files to mount");
        node_free(root);
        node_free(system);
        return NULL;
    }

    ctx->stats.nodes_total += 2;

    if (node_child_append(root, system) != 0) {
        LOGE("build_mount_tree: failed to attach /system node to root");
        node_free(system);
        return tree_fail(ctx, root, NULL);
    }

    LOGI("build_mount_tree: root tree successfully built");
    return root;
}

void module_tree_cleanup(MagicMount *ctx) {
    if (!ctx)
        return;

    str_array_free(&ctx->failed_modules, &ctx->failed_modules_count);
    str_array_free(&ctx->extra_parts, &ctx->extra_parts_count);
    str_array_free(&ctx->priority, &ctx->priority_count);

    for (int i = 0; i < ctx->modules_count; ++i) {
        free(ctx->modules[i].id);
        free(ctx->modules[i].path);
    }
    free(ctx->modules);
    ctx->modules = NULL;
    ctx->modules_count = 0;

    for (int i = 0; i < ctx->conflicts_count; ++i) {
        free(ctx->conflicts[i].path);
        free(ctx->conflicts[i].winner);
        free(ctx->conflicts[i].loser);
    }
    free(ctx->conflicts);
    ctx->conflicts = NULL;
    ctx->conflicts_count = 0;
}
