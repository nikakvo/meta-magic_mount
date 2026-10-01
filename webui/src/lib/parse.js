// Pure functions: no device access, so they can be unit-tested with node.

export const DEFAULT_CONFIG = Object.freeze({
  moduledir: "/data/adb/modules",
  tempdir: "",
  mountsource: "KSU",
  logfile: "/data/adb/magic_mount/mm.log",
  verbose: false,
  umount: true,
  partitions: [],
  priority: [],
});

// Partitions mmd always handles itself (and rejects as "extra" partitions)
export const BUILTIN_PARTS = ["vendor", "product", "system_ext", "odm"];
// Names mmd refuses as extra partitions (see extra_part_blacklisted in module_tree.c)
const PART_BLACKLIST = new Set([
  "bin", "etc", "data", "data_mirror", "sdcard", "tmp", "dev", "sys",
  "mnt", "proc", "d", "test", "system", ...BUILTIN_PARTS,
]);

export const MODULE_ID_RE = /^[A-Za-z0-9._-]+$/;
export const PART_RE = /^[A-Za-z0-9_]+$/;
const SOURCE_RE = /^[A-Za-z0-9._-]{1,32}$/;
// Config values are written unquoted; keep them to plain absolute paths
const PATH_RE = /^\/[^\s"'`$\\#]*$/;

export function isTrue(v) {
  return ["1", "true", "yes", "on"].includes(String(v).trim().toLowerCase());
}

// Mirrors load_config_file() in main.c: whole-line "#" comments, first "="
// splits, case-insensitive keys, empty values ignored, last one wins.
export function parseConfig(text) {
  const cfg = { ...DEFAULT_CONFIG, partitions: [], priority: [] };
  for (let line of String(text || "").split("\n")) {
    line = line.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim().toLowerCase();
    const val = line.slice(eq + 1).trim();
    if (!key || !val) continue;
    switch (key) {
      case "module_dir": cfg.moduledir = val; break;
      case "temp_dir": cfg.tempdir = val; break;
      case "mount_source": cfg.mountsource = val; break;
      case "log_file": cfg.logfile = val; break;
      case "debug": cfg.verbose = isTrue(val); break;
      case "umount": cfg.umount = isTrue(val); break;
      case "partitions":
        cfg.partitions = splitList(val);
        break;
      case "priority":
        cfg.priority = splitList(val);
        break;
    }
  }
  return cfg;
}

export function splitList(s) {
  return [...new Set(String(s || "").split(/[\s,]+/).map((p) => p.trim()).filter(Boolean))];
}

export function serializeConfig(cfg, { omitUmount = false } = {}) {
  const lines = ["# Magic Mount configuration", "# Written by the Magic Mount WebUI", ""];
  lines.push(`module_dir=${cfg.moduledir || DEFAULT_CONFIG.moduledir}`);
  if (cfg.tempdir) lines.push(`temp_dir=${cfg.tempdir}`);
  lines.push(`mount_source=${cfg.mountsource || DEFAULT_CONFIG.mountsource}`);
  if (cfg.logfile) lines.push(`log_file=${cfg.logfile}`);
  lines.push(`debug=${cfg.verbose ? "true" : "false"}`);
  if (!omitUmount) lines.push(`umount=${cfg.umount ? "true" : "false"}`);
  if (cfg.partitions?.length) lines.push(`partitions=${cfg.partitions.join(",")}`);
  if (cfg.priority?.length) lines.push(`priority=${cfg.priority.join(",")}`);
  return lines.join("\n") + "\n";
}

// Returns { field: message } for every invalid field (empty object = valid).
// `form` holds the raw text of each input.
export function validateConfig(form, t) {
  const errors = {};
  const path = (key, value, { optional = false, allowDash = false } = {}) => {
    const v = value.trim();
    if (!v) {
      if (!optional) errors[key] = t.required;
      return;
    }
    if (allowDash && v === "-") return;
    if (!PATH_RE.test(v)) errors[key] = t.path;
  };
  path("moduledir", form.moduledir);
  path("tempdir", form.tempdir, { optional: true });
  path("logfile", form.logfile, { optional: true, allowDash: true });
  const src = form.mountsource.trim();
  if (!src) errors.mountsource = t.required;
  else if (!SOURCE_RE.test(src)) errors.mountsource = t.source;
  const parts = splitList(form.partitions);
  const bad = parts.filter((p) => !PART_RE.test(p));
  const builtin = parts.filter((p) => PART_RE.test(p) && PART_BLACKLIST.has(p));
  if (bad.length) errors.partitions = t.partName(bad.join(", "));
  else if (builtin.length) errors.partitions = t.partBuiltin(builtin.join(", "));
  const ids = splitList(form.priority ?? "");
  const badIds = ids.filter((id) => !MODULE_ID_RE.test(id) || id === "." || id === "..");
  if (badIds.length) errors.priority = t.moduleId(badIds.join(", "));
  return errors;
}

// status file written by metamount.sh (key=value)
export function parseStatus(text) {
  if (!text || !text.trim()) return null;
  const kv = {};
  for (const line of text.split("\n")) {
    const eq = line.indexOf("=");
    if (eq > 0) kv[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  const num = (v) => (v === undefined || v === "" || isNaN(Number(v)) ? null : Number(v));
  return {
    bootId: kv.boot_id || "",
    result: kv.result || "",
    exitCode: num(kv.exit_code),
    root: kv.root || "",
    version: kv.version || "",
    startCs: num(kv.start_cs),
    endCs: num(kv.end_cs),
    // Real start of that boot (epoch s), added by service.sh once the clock is set
    bootStart: num(kv.boot_start),
  };
}

// "/proc/uptime" -> seconds since boot, or null
export function parseUptime(text) {
  const m = String(text || "").trim().match(/^(\d+(?:\.\d+)?)(?:\s|$)/);
  return m ? Number(m[1]) : null;
}

// A wall clock earlier than this has not been set yet (2026-01-01 UTC);
// service.sh uses the same value.
export const CLOCK_FLOOR = 1767225600;

// When a log was written, in epoch seconds, or null when no reliable time
// exists. The log file's own mtime is useless: mmd writes it in
// post-fs-data, before Android sets the clock. Instead:
//   mm.log     - status. If it is this boot's record: boot start =
//                now - uptime, plus when mmd finished. If Magic Mount did not
//                run this boot, mm.log is still the older boot's log, so its
//                boot_start (from service.sh) is used, which shows it is old.
//   mm.log.old - status.old: boot_start plus when mmd finished.
// `now` is epoch seconds, `uptime` seconds since boot.
export function logWrittenAt({ previous = false, status, statusOld, bootId, uptime, now }) {
  const ranFor = (st) => st.endCs ?? st.startCs ?? null;
  const fromRecord = (st) => {
    if (!st || st.bootStart == null || st.bootStart < CLOCK_FLOOR) return null;
    if (st.result === "missing-binary") return null; // mmd never wrote a log
    const cs = ranFor(st);
    return cs == null ? null : st.bootStart + cs / 100;
  };
  const sameBoot = (st) => !!(st?.bootId && bootId && st.bootId === bootId);

  if (previous) return sameBoot(statusOld) ? null : fromRecord(statusOld);

  if (!status || !status.bootId || !bootId) return null;
  if (!sameBoot(status)) return fromRecord(status);
  if (status.result === "missing-binary") return null;
  if (uptime == null || now == null || now < CLOCK_FLOOR) return null;
  const cs = ranFor(status);
  if (cs == null || cs / 100 > uptime) return null;
  return now - uptime + cs / 100;
}

// boot_state file: "<id>\t<on|skip|disable|remove>" per module
export function parseBootState(text) {
  const map = new Map();
  for (const line of String(text || "").split("\n")) {
    const [id, state] = line.split("\t");
    if (id && state) map.set(id.trim(), state.trim());
  }
  return map;
}

// Did metamount.sh run during the boot we are in now?
export function statusIsCurrent(status, bootId) {
  if (!status) return false;
  // Kernels without boot_id: trust the file
  if (!status.bootId || !bootId) return true;
  return status.bootId === bootId;
}

// Summary block printed by mmd at the end of every run
export function parseSummary(log) {
  if (!log || !log.trim()) return null;
  const count = (label) => {
    const m = log.match(new RegExp(`${label}:\\s+(\\d+)`));
    return m ? Number(m[1]) : null;
  };
  const rc = log.match(/Magic Mount Failed \(rc=(-?\d+)\)/);
  const s = {
    completed: /Magic Mount Completed Successfully/.test(log),
    failedRc: rc ? Number(rc[1]) : null,
    nothing: /no modules, magic_mount skipped/.test(log),
    modules: count("Modules processed"),
    total: count("Nodes total"),
    mounted: count("Nodes mounted"),
    skipped: count("Nodes skipped") ?? 0,
    whiteouts: count("Whiteouts") ?? 0,
    failures: count("Failures") ?? 0,
    failedModules: [],
  };
  const at = log.indexOf("Failed modules (");
  if (at !== -1) {
    for (const line of log.slice(at).split("\n").slice(1)) {
      const m = line.match(/\]\s.*?:\s+-\s+(.+)$/) || line.match(/^\s+-\s+(.+)$/);
      if (!m) break;
      s.failedModules.push(m[1].trim());
    }
  }
  return s;
}

// One line per module from the device scan:
// id \t name \t disabled \t remove \t skip \t tracked \t update \t parts
export function parseModuleScan(text) {
  return String(text || "")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => {
      const [id, name, dis, rem, skip, tracked, update, parts] = l.split("\t");
      return {
        id,
        name: name || id,
        disabled: dis === "1",
        remove: rem === "1",
        skipMount: skip === "1",
        tracked: tracked === "1",
        update: update === "1",
        parts: [...new Set((parts || "").split(",").filter(Boolean))],
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function mountsNextBoot(m) {
  return !m.disabled && !m.remove && !m.skipMount;
}

// Compare every module with what the current boot actually did.
// baseline: Map id -> bool (mounted this boot), or null when unknown.
export function withPending(modules, baseline) {
  return modules.map((m) => {
    const next = mountsNextBoot(m);
    const now = baseline ? baseline.get(m.id) === true : next;
    let change = null;
    if (baseline && now !== next) change = next ? "mount" : "unmount";
    else if (m.update && next) change = "update";
    return { ...m, mountedNow: now, change };
  });
}

// Mounted-this-boot map from the boot_state snapshot
export function baselineFromBootState(bootState) {
  const map = new Map();
  for (const [id, state] of bootState) map.set(id, state === "on");
  return map;
}

export function formatSeconds(cs) {
  if (cs === null || cs === undefined || cs < 0) return null;
  if (cs === 0) return "under 0.01 s";
  return `${(cs / 100).toFixed(cs < 1000 ? 2 : 1)} s`;
}

// Report of `mmd --dry-run` (tab separated, see print_dry_run in main.c).
// Returns null when the text is not such a report (e.g. an old binary).
export function parseDryRun(text) {
  const lines = String(text || "").split("\n").filter((l) => l.trim());
  if (!lines.length || !lines[0].startsWith("mmd-dry-run\t")) return null;
  const out = { result: "error", order: [], conflicts: [], unreadable: [] };
  for (const line of lines.slice(1)) {
    const f = line.split("\t");
    switch (f[0]) {
      case "order":
        out.order.push({ id: f[2], pending: f[3] === "update" });
        break;
      case "conflict":
        if (f.length >= 5) out.conflicts.push({ kind: f[1], path: f[2], winner: f[3], loser: f[4] });
        break;
      case "unreadable":
        out.unreadable.push(f[1]);
        break;
      case "result":
        out.result = f[1];
        break;
    }
  }
  return out;
}

// Conflicts as the WebUI shows them:
//   pairs    - one entry per (winner, loser): the loser's files are ignored
//   replaces - a module empties a folder another one adds files to
//   same     - number of identical files shipped twice (no visible effect)
export function groupConflicts(conflicts) {
  const pairs = new Map();
  const replaces = [];
  let same = 0;
  for (const c of conflicts || []) {
    if (c.kind === "same") {
      same++;
    } else if (c.kind === "replace") {
      replaces.push(c);
    } else {
      const key = `${c.winner}\t${c.loser}`;
      if (!pairs.has(key)) pairs.set(key, { winner: c.winner, loser: c.loser, items: [] });
      pairs.get(key).items.push({ path: c.path, kind: c.kind });
    }
  }
  const list = [...pairs.values()];
  for (const p of list) p.items.sort((a, b) => a.path.localeCompare(b.path));
  list.sort((a, b) => b.items.length - a.items.length || a.winner.localeCompare(b.winner));
  return { pairs: list, replaces, same };
}

// Mount order with `id` moved to the front: it then wins all its conflicts
export function preferModule(priority, id) {
  return [id, ...(priority || []).filter((x) => x !== id)];
}

// "other modules that mount": "<id>\t<name>" per line
export function parseOtherMounters(text) {
  return String(text || "")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => {
      const [id, name] = l.split("\t");
      return { id, name: name || id };
    });
}
