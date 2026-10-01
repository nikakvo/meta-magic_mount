// Everything that touches the device goes through here.
// In `pnpm dev` (desktop browser, no KernelSU bridge) mock.js is used instead.

import { exec } from "kernelsu";
import {
  DEFAULT_CONFIG,
  BUILTIN_PARTS,
  MODULE_ID_RE,
  PART_RE,
  parseConfig,
  parseStatus,
  parseUptime,
  parseBootState,
  parseModuleScan,
  serializeConfig,
  parseDryRun,
  parseOtherMounters,
} from "./parse.js";

export const MODULE_ID = "meta-mm";
export const MODULE_PATH = `/data/adb/modules/${MODULE_ID}`;
export const DATA_DIR = "/data/adb/magic_mount";
export const CONFIG_PATH = `${DATA_DIR}/mm.conf`;
const BOOT_CONFIG = `${DATA_DIR}/boot_config`;
const STATUS = `${DATA_DIR}/status`;
const STATUS_OLD = `${DATA_DIR}/status.old`;
const BOOT_STATE = `${DATA_DIR}/boot_state`;
const SKIP_LIST = `${DATA_DIR}/skip_mount.list`;
const LOG_LINES = 20000;

// Dev-only fake device; the whole branch is removed from production builds
const useMock = import.meta.env.DEV && typeof window.ksu === "undefined";
const mockModule = import.meta.env.DEV ? import("./mock.js") : null;
const mockApi = async () => (await mockModule).mock;

// Escape for use inside double quotes in sh
export function q(s) {
  return String(s).replace(/(["\\$`])/g, "\\$1");
}

async function sh(cmd) {
  const r = await exec(cmd);
  return { errno: r.errno, stdout: r.stdout || "", stderr: r.stderr || "" };
}

function sections(text) {
  const out = {};
  let cur = null;
  for (const line of text.split("\n")) {
    const m = line.match(/^@@(\w+)$/);
    if (m) {
      cur = m[1];
      out[cur] = [];
    } else if (cur) {
      out[cur].push(line);
    }
  }
  for (const k in out) out[k] = out[k].join("\n").replace(/\n+$/, "");
  return out;
}

// Module info, config, and what the current boot did - one shell call
export async function readOverview() {
  if (useMock) return (await mockApi()).readOverview();
  const { errno, stdout } = await sh(`
    echo @@aok; cat "${MODULE_PATH}/aok" 2>/dev/null
    echo @@prop; cat "${MODULE_PATH}/module.prop" 2>/dev/null
    echo @@config; cat "${CONFIG_PATH}" 2>/dev/null
    echo @@hasconfig; [ -f "${CONFIG_PATH}" ] && echo 1
    echo @@bootconfig; cat "${BOOT_CONFIG}" 2>/dev/null
    echo @@hasbootconfig; [ -f "${BOOT_CONFIG}" ] && echo 1
    echo @@status; cat "${STATUS}" 2>/dev/null
    echo @@statusold; cat "${STATUS_OLD}" 2>/dev/null
    echo @@bootstate; cat "${BOOT_STATE}" 2>/dev/null
    echo @@bootid; cat /proc/sys/kernel/random/boot_id 2>/dev/null
    echo @@uptime; cat /proc/uptime 2>/dev/null
    true
  `);
  // Taken right after the shell call, so it pairs with the uptime above
  const now = Date.now() / 1000;
  if (errno !== 0) throw new Error("Could not read module data");
  const s = sections(stdout);
  const prop = Object.fromEntries(
    (s.prop || "").split("\n").map((l) => [l.split("=")[0], l.slice(l.indexOf("=") + 1)]),
  );
  const root = ((s.aok || "").match(/^AOK=(.*)$/m) || [])[1] || "";
  return {
    version: (prop.version || "").trim(),
    root: root.replace(/^["']|["']$/g, "").trim(),
    config: parseConfig(s.config),
    configText: s.config || "",
    hasConfig: s.hasconfig === "1",
    bootConfigText: s.hasbootconfig === "1" ? s.bootconfig || "" : null,
    status: parseStatus(s.status),
    statusOld: parseStatus(s.statusold),
    bootState: s.bootstate ? parseBootState(s.bootstate) : null,
    bootId: (s.bootid || "").trim(),
    uptime: parseUptime(s.uptime),
    now,
  };
}

// Modules that ship files for any partition Magic Mount handles
export async function listModules(moduleDir, extraParts = []) {
  if (useMock) return (await mockApi()).listModules();
  const dir = q(moduleDir || DEFAULT_CONFIG.moduledir);
  const extra = extraParts.filter((p) => PART_RE.test(p)).join(" ");
  const builtin = BUILTIN_PARTS.join(" ");
  const { errno, stdout } = await sh(`
    MOD_DIR="${dir}"
    UPD_DIR="\${MOD_DIR%/*}/modules_update"
    LIST="${SKIP_LIST}"
    [ -d "$MOD_DIR" ] || exit 0
    for m in "$MOD_DIR"/*; do
      [ -d "$m" ] || continue
      id="\${m##*/}"
      [ "$id" = "${MODULE_ID}" ] && continue
      src="$m"; upd=0
      if [ -e "$m/update" ] && [ -d "$UPD_DIR/$id" ]; then src="$UPD_DIR/$id"; upd=1; fi
      parts=""
      if [ -d "$src/system" ]; then
        other=0
        for e in "$src/system"/* "$src/system"/.[!.]*; do
          [ -e "$e" ] || [ -L "$e" ] || continue
          b="\${e##*/}"
          case " ${builtin} " in
            *" $b "*)
              if [ -d "$e" ] && [ ! -L "$e" ]; then parts="$parts,$b"; else other=1; fi ;;
            *) other=1 ;;
          esac
        done
        [ "$other" = 1 ] && parts="system$parts"
      fi
      for p in ${builtin} ${extra}; do
        [ -d "$src/$p" ] && [ ! -L "$src/$p" ] && parts="$parts,$p"
      done
      [ -n "$parts" ] || continue
      name="$(sed -n 's/^name=//p' "$src/module.prop" 2>/dev/null | head -n 1)"
      [ -n "$name" ] || name="$(sed -n 's/^name=//p' "$m/module.prop" 2>/dev/null | head -n 1)"
      name="$(printf '%s' "$name" | tr '\\t' ' ')"
      dis=0; rem=0; skip=0; trk=0
      [ -e "$m/disable" ] && dis=1
      [ -e "$m/remove" ] && rem=1
      [ -e "$m/skip_mount" ] && skip=1
      [ -f "$LIST" ] && grep -qxF "$id" "$LIST" && trk=1
      printf '%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\n' "$id" "$name" "$dis" "$rem" "$skip" "$trk" "$upd" "$parts"
    done
  `);
  if (errno !== 0) throw new Error("List modules failed");
  return parseModuleScan(stdout);
}

// Switch mounting of one module on or off. The skip list records which
// skip_mount files this app created (see metamount.sh / uninstall.sh).
export async function setMounting(moduleDir, id, mount) {
  if (!MODULE_ID_RE.test(id) || id === "." || id === "..") throw new Error("Invalid module id");
  if (useMock) return (await mockApi()).setMounting(id, mount);
  const file = q(`${moduleDir}/${id}/skip_mount`);
  const cmd = mount
    ? `rm -f "${file}" || exit 1
       if [ -f "${SKIP_LIST}" ]; then
         grep -vxF "${id}" "${SKIP_LIST}" > "${SKIP_LIST}.tmp"
         mv -f "${SKIP_LIST}.tmp" "${SKIP_LIST}" && chmod 0644 "${SKIP_LIST}"
       fi`
    : `[ -d "${q(`${moduleDir}/${id}`)}" ] || exit 1
       touch "${file}" || exit 1
       mkdir -p "${DATA_DIR}"
       grep -qxF "${id}" "${SKIP_LIST}" 2>/dev/null || echo "${id}" >> "${SKIP_LIST}"
       chmod 0644 "${SKIP_LIST}"`;
  const { errno, stderr } = await sh(cmd);
  if (errno !== 0) throw new Error(stderr || "Toggle failed");
}

export async function saveConfig(cfg, { omitUmount = false } = {}) {
  const text = serializeConfig(cfg, { omitUmount });
  if (useMock) return (await mockApi()).saveConfig(text);
  const body = text.replace(/'/g, "'\\''");
  const { errno, stderr } = await sh(
    `mkdir -p "${DATA_DIR}" &&
     printf '%s' '${body}' > "${CONFIG_PATH}.tmp" &&
     chmod 0644 "${CONFIG_PATH}.tmp" &&
     mv -f "${CONFIG_PATH}.tmp" "${CONFIG_PATH}"`,
  );
  if (errno !== 0) throw new Error(stderr || "Save failed");
  return text;
}

// Returns { text, disabled } - disabled when logging to a file is off.
// When the log was written comes from the boot records (logWrittenAt in
// parse.js), not from the file: its mtime is set before the clock is.
export async function readLog(logFile, previous = false) {
  if (!logFile || logFile === "-") return { text: "", disabled: true };
  if (useMock) return { ...(await mockApi()).readLog(previous), disabled: false };
  const path = q(previous ? `${logFile}.old` : logFile);
  const { errno, stdout, stderr } = await sh(
    `[ -f "${path}" ] || exit 0; tail -n ${LOG_LINES} "${path}"`,
  );
  if (errno !== 0) throw new Error(stderr || "Read failed");
  return { text: stdout, disabled: false };
}

// What the next boot will mount: mount order and conflicts from
// `mmd --dry-run` (reads mm.conf itself, includes installed updates), plus
// other installed modules that also mount module files.
export async function checkConflicts(moduleDir) {
  if (useMock) return (await mockApi()).checkConflicts();
  const dir = q(moduleDir || DEFAULT_CONFIG.moduledir);
  const { errno, stdout } = await sh(`
    echo @@dryrun
    "${MODULE_PATH}/mmd" --dry-run 2>/dev/null
    echo @@others
    MOD_DIR="${dir}"
    seen=" "
    for m in "$MOD_DIR"/* "\${MOD_DIR%/*}/modules_update"/*; do
      [ -f "$m/module.prop" ] || continue
      id="\${m##*/}"
      [ "$id" = "${MODULE_ID}" ] && continue
      [ -e "$MOD_DIR/$id/remove" ] && continue
      case "$seen" in *" $id "*) continue ;; esac
      if grep -qiE '^metamodule=(1|true)[[:space:]]*$' "$m/module.prop" || [ "$id" = mountify ]; then
        seen="$seen$id "
        name="$(sed -n 's/^name=//p' "$m/module.prop" | head -n 1 | tr '\\t' ' ')"
        printf '%s\\t%s\\n' "$id" "$name"
      fi
    done
    true
  `);
  if (errno !== 0) throw new Error("Conflict check failed");
  const s = sections(stdout);
  const report = parseDryRun(s.dryrun);
  if (!report) throw new Error("No dry-run report");
  return { ...report, others: parseOtherMounters(s.others) };
}
