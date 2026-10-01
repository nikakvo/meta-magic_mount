#include "magic_mount.h"
#include "module_tree.h"
#include "utils.h"

#include <ctype.h>
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>

#define DEFAULT_CONFIG_PATH "/data/adb/magic_mount/mm.conf"

/* --- Configuration structure --- */
typedef struct {
    const char *module_dir;
    const char *temp_dir;
    const char *mount_source;
    const char *log_file;
    const char *partitions;
    const char *priority;
    bool debug;
    bool umount;
} Config;

/* --- Forward declarations --- */
static void usage(const char *prog);
static int load_config_file(const char *path, Config *cfg);
typedef void (*list_item_fn)(MagicMount *ctx, const char *start, size_t len);
static int parse_list(const char *list, MagicMount *ctx, list_item_fn fn);
static int print_dry_run(MagicMount *ctx);
static int setup_logging(const char *log_path);
static void print_summary(const MagicMount *ctx);
static void cleanup_resources(MagicMount *ctx);

/* --- Helper function implementations --- */
static void usage(const char *prog) {
    fprintf(stderr,
            "Magic Mount: %s\n"
            "\n"
            "Usage: %s [options]\n"
            "\n"
            "Options:\n"
            "  -m, --module-dir DIR      Module directory (default: %s)\n"
            "  -t, --temp-dir DIR        Temporary directory (default: auto-detected)\n"
            "  -s, --mount-source SRC    Mount source (default: %s)\n"
            "  -p, --partitions LIST     Extra partitions (eg. mi_ext,my_stock)\n"
            "  -P, --priority LIST       Modules that win conflicts, most preferred first\n"
            "  -l, --log-file FILE       Log file (default: stderr, '-' for stdout)\n"
            "  -c, --config FILE         Config file (default: %s)\n"
            "  -v, --verbose             Enable debug logging\n"
            "      --no-umount           Do not register mounts for KernelSU umount\n"
            "  -n, --dry-run             Mount nothing; print the mount order and the\n"
            "                            conflicts the next boot will have\n"
            "  -V, --version             Print the version\n"
            "  -h, --help                Show this help message\n"
            "\n"
            "Mounting runs once per boot (metamount.sh). Running it again by hand\n"
            "stacks a second set of mounts; use --dry-run to inspect.\n"
            "\n",
            VERSION, prog, DEFAULT_MODULE_DIR, DEFAULT_MOUNT_SOURCE, DEFAULT_CONFIG_PATH);
}

static int load_config_file(const char *path, Config *cfg) {
    FILE *fp = fopen(path, "r");
    if (!fp) {
        if (errno != ENOENT) {
            LOGW("config file %s: %s", path, strerror(errno));
        }
        return -1;
    }

    LOGI("Loading config file: %s", path);

    char line[1024];
    int line_num = 0;

    while (fgets(line, sizeof(line), fp)) {
        line_num++;

        str_trim(line);

        if (line[0] == '\0' || line[0] == '#')
            continue;

        char *eq = strchr(line, '=');
        if (!eq) {
            LOGW("config:%d: invalid line (no '=')", line_num);
            continue;
        }

        *eq = '\0';
        char *key = str_trim(line);
        char *val = str_trim(eq + 1);

        if (*key == '\0' || *val == '\0')
            continue;

        /* Process key-value pairs */
        if (!strcasecmp(key, "module_dir")) {
            cfg->module_dir = strdup(val);

        } else if (!strcasecmp(key, "temp_dir")) {
            cfg->temp_dir = strdup(val);

        } else if (!strcasecmp(key, "mount_source")) {
            cfg->mount_source = strdup(val);

        } else if (!strcasecmp(key, "log_file")) {
            cfg->log_file = strdup(val);

        } else if (!strcasecmp(key, "debug")) {
            cfg->debug = str_is_true(val);

        } else if (!strcasecmp(key, "umount")) {
            cfg->umount = str_is_true(val);

        } else if (!strcasecmp(key, "partitions")) {
            cfg->partitions = strdup(val);

        } else if (!strcasecmp(key, "priority")) {
            cfg->priority = strdup(val);

        } else {
            LOGW("config:%d: unknown key '%s'", line_num, key);
        }
    }

    fclose(fp);
    return 0;
}

static int parse_list(const char *list, MagicMount *ctx, list_item_fn fn) {
    if (!list || !*list)
        return 0;

    const char *p = list;
    while (*p) {
        /* Find start of token */
        while (*p && (*p == ',' || isspace((unsigned char)*p)))
            p++;

        if (!*p)
            break;

        const char *start = p;

        /* Find end of token */
        while (*p && *p != ',' && !isspace((unsigned char)*p))
            p++;

        size_t len = (size_t)(p - start);
        if (len > 0)
            fn(ctx, start, len);
    }

    return 0;
}

static int setup_logging(const char *log_path) {
    if (!log_path)
        return 0;

    FILE *fp = NULL;

    if (!strcmp(log_path, "-")) {
        fp = stdout;
    } else {
        /* Make sure the parent directory exists (e.g. after a manual cleanup) */
        char parent[PATH_MAX];
        if (snprintf(parent, sizeof(parent), "%s", log_path) < (int)sizeof(parent)) {
            char *slash = strrchr(parent, '/');
            if (slash && slash != parent) {
                *slash = '\0';
                (void)mkdir_p(parent);
            }
        }

        fp = fopen(log_path, "a");
        if (!fp) {
            fprintf(stderr, "Error: Cannot open log file %s: %s\n", log_path, strerror(errno));
            return -1;
        }
        /* Ensure log is line-buffered */
        setvbuf(fp, NULL, _IOLBF, 0);
    }

    log_set_file(fp);
    return 0;
}

static void print_summary(const MagicMount *ctx) {
    LOGI("Summary");
    LOGI("Modules processed:     %d", ctx->stats.modules_total);
    LOGI("Nodes total:           %d", ctx->stats.nodes_total);
    LOGI("Nodes mounted:         %d", ctx->stats.nodes_mounted);
    LOGI("Nodes skipped:         %d", ctx->stats.nodes_skipped);
    LOGI("Whiteouts:             %d", ctx->stats.nodes_whiteout);
    LOGI("Failures:              %d", ctx->stats.nodes_fail);

    int real = 0;
    for (int i = 0; i < ctx->conflicts_count; i++) {
        if (ctx->conflicts[i].kind != CONFLICT_SAME)
            real++;
    }
    LOGI("Conflicts:             %d", real);

    if (ctx->failed_modules_count > 0) {
        LOGE("Failed modules (%d):", ctx->failed_modules_count);
        for (int i = 0; i < ctx->failed_modules_count; i++) {
            LOGE("  - %s", ctx->failed_modules[i]);
        }
    } else {
        LOGI("No module failures");
    }
}

/* Machine-readable report for the WebUI, tab separated:
 *   order    <n> <id> <installed|update>
 *   conflict <kind> <path> <winner> <loser>
 *   result   <ok|empty|error> <modules> <conflicts>
 */
static int print_dry_run(MagicMount *ctx) {
    Node *root = build_mount_tree(ctx);
    bool error = !root && ctx->tree_error;

    printf("mmd-dry-run\t1\t%s\n", VERSION);
    for (int i = 0; i < ctx->modules_count; i++) {
        printf("order\t%d\t%s\t%s\n", i + 1, ctx->modules[i].id,
               ctx->modules[i].pending ? "update" : "installed");
    }
    for (int i = 0; i < ctx->conflicts_count; i++) {
        const Conflict *c = &ctx->conflicts[i];
        printf("conflict\t%s\t%s\t%s\t%s\n", conflict_kind_name(c->kind), c->path, c->winner,
               c->loser);
    }
    for (int i = 0; i < ctx->failed_modules_count; i++)
        printf("unreadable\t%s\n", ctx->failed_modules[i]);
    printf("result\t%s\t%d\t%d\n", error ? "error" : (root ? "ok" : "empty"), ctx->modules_count,
           ctx->conflicts_count);
    fflush(stdout);

    node_free(root);
    return error ? 1 : 0;
}

static void cleanup_resources(MagicMount *ctx) {
    if (!ctx)
        return;

    magic_mount_cleanup(ctx);

    if (g_log_file && g_log_file != stdout && g_log_file != stderr) {
        fclose(g_log_file);
        g_log_file = NULL;
    }
}

/* --- Main function --- */
static bool is_opt(const char *arg, const char *s, const char *l) {
    return (s && !strcmp(arg, s)) || (l && !strcmp(arg, l));
}

int main(int argc, char **argv) {
    MagicMount ctx;
    Config cfg = {0};
    cfg.umount = true;
    char auto_tmp[PATH_MAX] = {0};

    const char *config_path = DEFAULT_CONFIG_PATH;
    const char *tmp_dir = NULL;
    const char *cli_log_path = NULL;
    bool cli_has_partitions = false;
    bool cli_has_priority = false;
    bool dry_run = false;
    int rc;

    magic_mount_init(&ctx);

    /* First pass: options that decide how everything else is read */
    for (int i = 1; i < argc; i++) {
        const char *arg = argv[i];

        if (is_opt(arg, "-c", "--config") && i + 1 < argc) {
            config_path = argv[++i];
        } else if (is_opt(arg, "-l", "--log-file") && i + 1 < argc) {
            cli_log_path = argv[++i];
        } else if (is_opt(arg, "-n", "--dry-run")) {
            dry_run = true;
        } else if (is_opt(arg, "-V", "--version")) {
            printf("%s\n", VERSION);
            return 0;
        } else if (is_opt(arg, "-h", "--help")) {
            usage(argv[0]);
            return 0;
        }
    }

    if (dry_run) {
        /* Never touch the boot log; the report goes to stdout */
        log_set_level(LOG_ERROR);
        if (cli_log_path && setup_logging(cli_log_path) < 0)
            return 1;
    } else if (cli_log_path && setup_logging(cli_log_path) < 0) {
        fprintf(stderr, "Error: Failed to setup logging to %s\n", cli_log_path);
        return 1;
    }

    load_config_file(config_path, &cfg);

    if (!dry_run && !cli_log_path && cfg.log_file && setup_logging(cfg.log_file) < 0) {
        /* A bad log path must never stop the modules from being mounted */
        fprintf(stderr, "Warning: logging to stderr instead of %s\n", cfg.log_file);
    }

    /* No log file at all: flush the early buffer to stderr and log there */
    if (!g_log_initialized)
        log_set_file(NULL);

    if (cfg.module_dir)
        ctx.module_dir = cfg.module_dir;
    if (cfg.mount_source)
        ctx.mount_source = cfg.mount_source;
    if (cfg.temp_dir)
        tmp_dir = cfg.temp_dir;
    if (cfg.debug && !dry_run)
        log_set_level(LOG_DEBUG);
    ctx.enable_unmountable = cfg.umount;

    for (int i = 1; i < argc; i++) {
        const char *arg = argv[i];

        if ((is_opt(arg, "-c", "--config") || is_opt(arg, "-l", "--log-file")) && i + 1 < argc) {
            i++;
        } else if (is_opt(arg, "-n", "--dry-run")) {
            /* handled above */
        } else if (is_opt(arg, "-m", "--module-dir") && i + 1 < argc) {
            ctx.module_dir = argv[++i];
        } else if (is_opt(arg, "-t", "--temp-dir") && i + 1 < argc) {
            tmp_dir = argv[++i];
        } else if (is_opt(arg, "-s", "--mount-source") && i + 1 < argc) {
            ctx.mount_source = argv[++i];
        } else if (is_opt(arg, "-v", "--verbose")) {
            log_set_level(LOG_DEBUG);
        } else if (is_opt(arg, NULL, "--no-umount")) {
            ctx.enable_unmountable = false;
        } else if (is_opt(arg, "-p", "--partitions") && i + 1 < argc) {
            cli_has_partitions = true;
            parse_list(argv[++i], &ctx, extra_partition_register);
        } else if (is_opt(arg, "-P", "--priority") && i + 1 < argc) {
            cli_has_priority = true;
            parse_list(argv[++i], &ctx, priority_register);
        } else {
            fprintf(stderr, "Error: Unknown argument: %s\n\n", arg);
            usage(argv[0]);
            cleanup_resources(&ctx);
            return 1;
        }
    }

    if (!cli_has_partitions && cfg.partitions)
        parse_list(cfg.partitions, &ctx, extra_partition_register);
    if (!cli_has_priority && cfg.priority)
        parse_list(cfg.priority, &ctx, priority_register);

    if (dry_run) {
        ctx.use_pending_updates = true;
        rc = print_dry_run(&ctx);
        cleanup_resources(&ctx);
        return rc;
    }

    /* Determine temp directory */
    if (!tmp_dir)
        tmp_dir = select_auto_tempdir(auto_tmp);

    if (!tmp_dir || *tmp_dir == '\0') {
        LOGE("failed to determine temp directory");
        cleanup_resources(&ctx);
        return 1;
    }

    /* Validate environment */
    if (root_check() < 0) {
        cleanup_resources(&ctx);
        return 1;
    }

    /* Log startup information */
    LOGI("Magic Mount %s Starting", VERSION);
    LOGI("Configuration:");
    LOGI("  Module directory:  %s", ctx.module_dir);
    LOGI("  Temp directory:    %s", tmp_dir);
    LOGI("  Mount source:      %s", ctx.mount_source);
    LOGI("  Log level:         %s", g_log_level == LOG_DEBUG ? "DEBUG" : "INFO");
    if (ctx.extra_parts_count > 0) {
        LOGI("  Extra partitions:  %d", ctx.extra_parts_count);
        for (int i = 0; i < ctx.extra_parts_count; i++)
            LOGI("    - %s", ctx.extra_parts[i]);
    }
    if (ctx.priority_count > 0) {
        LOGI("  Preferred modules: %d", ctx.priority_count);
        for (int i = 0; i < ctx.priority_count; i++)
            LOGI("    %d. %s", i + 1, ctx.priority[i]);
    }

    /* Perform magic mount */
    rc = magic_mount(&ctx, tmp_dir);

    /* Print results */
    if (rc == 0) {
        LOGI("Magic Mount Completed Successfully");
    } else {
        LOGE("Magic Mount Failed (rc=%d)", rc);
    }

    print_summary(&ctx);
    cleanup_resources(&ctx);

    return rc == 0 ? 0 : 1;
}
