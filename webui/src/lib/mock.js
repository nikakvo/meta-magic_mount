// Fake device for `pnpm dev` in a desktop browser.
// Scenario is chosen with ?mock=<name> in the URL:
//   ok (default) | pending | stale | failed | fresh | many | upgraded | conflicts
//   upgraded = first boot after updating from v1.1.5: this boot has a time,
//              the previous boot has none (no status.old / boot_start yet)

import { parseConfig, parseModuleScan } from "./parse.js";

const delay = (ms = 250) => new Promise((r) => setTimeout(r, ms));
const scenario = new URLSearchParams(location.search).get("mock") || "ok";

const BOOT_ID = "3f1c9a52-8d0e-4c1f-9b7a-2e6d5c4b3a21";
// This boot started 30 minutes ago, the previous one a day before that
const UPTIME = 1800.42;
const bootStartNow = () => Date.now() / 1000 - UPTIME;

const baseModules = [
  ["ath9k_htc_vermeer", "ath9k_htc (AR9271) for vermeer", "vendor"],
  ["chroot-distro", "chroot-distro-mod", "system"],
  ["dnscrypt-proxy-android", "DNSCrypt Proxy Arm64", "system"],
  ["ipset_arm64", "ipset (arm64)", "system"],
  ["sqlite3-arm64-only", "SQLite3 (Arm64 Only)", "system"],
];

const extraModules = [
  ["audio-tweaks", "Audio Tweaks", "system,vendor,odm"],
  ["mi-fonts", "MiSans Fonts", "system,product"],
  ["hosts-block", "Systemless Hosts", "system"],
  ["gms-doze", "GMS Doze", "system_ext,product"],
  ["cam-lib", "Camera Libraries", "vendor"],
  ["overlay-pack", "Overlay Pack", "product"],
  ["bootanim", "Boot Animation", "product"],
  ["mi_ext-tweak", "MIUI Extension Tweak", "mi_ext"],
  ["busybox-ndk", "Busybox for Android NDK", "system"],
  ["curl-bin", "cURL", "system"],
  ["zygisk-next", "Zygisk Next", "system"],
];

const withExtra = scenario === "many" || scenario === "conflicts";
const modules = (withExtra ? [...baseModules, ...extraModules] : baseModules).map(
  ([id, name, parts]) => ({ id, name, parts, disabled: false, remove: false, skip: false, tracked: false, update: false }),
);

let configText = `# Magic Mount configuration
module_dir=/data/adb/modules
mount_source=KSU
log_file=/data/adb/magic_mount/mm.log
debug=false
`;
let bootConfigText = configText;
let bootState = new Map(modules.map((m) => [m.id, "on"]));

if (scenario === "pending") {
  const sq = modules.find((m) => m.id === "sqlite3-arm64-only");
  sq.skip = true;
  sq.tracked = true;
  const ip = modules.find((m) => m.id === "ipset_arm64");
  ip.update = true;
  const ch = modules.find((m) => m.id === "chroot-distro");
  ch.skip = true; // shipped by the module itself, off at boot too
  bootState.set("chroot-distro", "skip");
  modules.find((m) => m.id === "ath9k_htc_vermeer").disabled = true;
  bootState.set("ath9k_htc_vermeer", "disable");
  configText = configText.replace("debug=false", "debug=true");
}
if (scenario === "many") {
  modules.find((m) => m.id === "gms-doze").disabled = true;
  bootState.set("gms-doze", "disable");
}

const logFor = (n) => {
  const failed = scenario === "failed";
  const lines = [
    "[INFO] main.c:260: Loading config file: /data/adb/magic_mount/mm.conf",
    "[INFO] utils.c:68: auto tempdir selected: /mnt/vendor/.magic_mount (from /mnt/vendor)",
    "[INFO] main.c:317: Magic Mount v1.1.3 Starting",
    "[INFO] main.c:318: Configuration:",
    "[INFO] main.c:319:   Module directory:  /data/adb/modules",
    "[INFO] main.c:320:   Temp directory:    /mnt/vendor/.magic_mount",
    "[INFO] main.c:321:   Mount source:      KSU",
    "[INFO] main.c:322:   Log level:         INFO",
    ...modules.map((m) => `[INFO] module_tree.c:699: build_mount_tree: collecting module ${m.id}`),
    "[INFO] module_tree.c:760: build_mount_tree: root tree successfully built",
    "[INFO] magic_mount.c:428: starting magic_mount core logic: tmpfs_source=KSU tmp_dir=/mnt/vendor/.magic_mount/workdir",
    "[INFO] magic_mount.c:392: move mountpoint success: /mnt/vendor/.magic_mount/workdir/system/bin -> /system/bin",
    ...(failed
      ? [
          "[ERROR] magic_mount.c:311: bind /data/adb/modules/ipset_arm64/system/bin/ipset->/system/bin/ipset: No such file or directory",
          "[ERROR] magic_mount.c:318: child /system/bin/ipset failed (module: ipset_arm64)",
          "[WARN] magic_mount.c:271: cannot create tmpfs on /vendor/lib (x) - child type: 1, target exists: 0",
          "[ERROR] main.c:337: Magic Mount Failed (rc=-1)",
        ]
      : ["[INFO] main.c:335: Magic Mount Completed Successfully"]),
    "[INFO] main.c:178: Summary",
    `[INFO] main.c:179: Modules processed:     ${n}`,
    `[INFO] main.c:180: Nodes total:           ${n * 5}`,
    `[INFO] main.c:181: Nodes mounted:         ${n * 3}`,
    `[INFO] main.c:182: Nodes skipped:         ${failed ? 1 : 0}`,
    "[INFO] main.c:183: Whiteouts:             0",
    `[INFO] main.c:184: Failures:              ${failed ? 1 : 0}`,
    ...(failed
      ? ["[ERROR] main.c:187: Failed modules (1):", "[ERROR] main.c:189:   - ipset_arm64"]
      : ["[INFO] main.c:192: No module failures"]),
  ];
  return lines.join("\n") + "\n";
};

export const mock = {
  async readOverview() {
    await delay();
    const status =
      scenario === "fresh"
        ? null
        : {
            bootId: scenario === "stale" ? "0000-older-boot" : BOOT_ID,
            result: scenario === "failed" ? "failed" : "ok",
            exitCode: scenario === "failed" ? 1 : 0,
            root: "KSU",
            version: "v1.1.3",
            startCs: 734,
            endCs: 746,
            // stale: record of the previous boot, stamped by its service.sh
            bootStart: scenario === "stale" ? Math.floor(bootStartNow() - 86400) : null,
          };
    const statusOld =
      scenario === "fresh" || scenario === "upgraded"
        ? null
        : {
            bootId: "9b0e-previous-boot",
            result: "ok",
            exitCode: 0,
            root: "KSU",
            version: "v1.1.3",
            startCs: 712,
            endCs: 725,
            bootStart: Math.floor(bootStartNow() - (scenario === "stale" ? 2 : 1) * 86400),
          };
    return {
      version: "v1.1.3",
      root: "KSU",
      config: parseConfig(configText),
      configText,
      hasConfig: true,
      bootConfigText,
      status,
      bootState: scenario === "fresh" ? null : new Map(bootState),
      bootId: BOOT_ID,
      statusOld,
      uptime: UPTIME,
      now: Date.now() / 1000,
    };
  },

  async listModules() {
    await delay();
    return parseModuleScan(
      modules
        .map((m) =>
          [m.id, m.name, +m.disabled, +m.remove, +m.skip, +m.tracked, +m.update, m.parts].join("\t"),
        )
        .join("\n"),
    );
  },

  async setMounting(id, mount) {
    await delay(200);
    const m = modules.find((x) => x.id === id);
    m.skip = !mount;
    m.tracked = !mount;
  },

  async saveConfig(text) {
    await delay(400);
    configText = text;
    return text;
  },

  async checkConflicts() {
    await delay(500);
    const cfg = parseConfig(configText);
    const rank = (id) => {
      const i = cfg.priority.indexOf(id);
      return i === -1 ? cfg.priority.length : i;
    };
    const order = modules
      .filter((m) => !m.disabled && !m.remove && !m.skip)
      .map((m) => m.id)
      .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
    const lines = ["mmd-dry-run\t1\tv1.2.0"];
    order.forEach((id, i) => lines.push(`order\t${i + 1}\t${id}\tinstalled`));
    const on = new Set(order);
    const pair = (a, b, paths, kind = "file") => {
      if (!on.has(a) || !on.has(b)) return;
      const [w, l] = order.indexOf(a) < order.indexOf(b) ? [a, b] : [b, a];
      for (const p of paths) lines.push(`conflict\t${kind}\t${p}\t${w}\t${l}`);
    };
    if (withExtra) {
      pair("busybox-ndk", "curl-bin", ["system/bin/curl"]);
      pair("audio-tweaks", "cam-lib", ["system/vendor/etc/audio_policy_configuration.xml",
        "system/vendor/etc/mixer_paths.xml"]);
      pair("busybox-ndk", "chroot-distro", ["system/bin/chroot"], "type");
      pair("hosts-block", "dnscrypt-proxy-android", ["system/etc/hosts"], "same");
      if (on.has("overlay-pack") && on.has("bootanim"))
        lines.push("conflict\treplace\tsystem/product/media\toverlay-pack\tbootanim");
    }
    lines.push(`result\tok\t${order.length}\t${lines.length - order.length - 1}`);
    const { parseDryRun } = await import("./parse.js");
    return {
      ...parseDryRun(lines.join("\n")),
      others:
        scenario === "conflicts" ? [{ id: "mountify", name: "Mountify" }] : [],
    };
  },

  readLog(previous) {
    if (scenario === "fresh") return { text: "" };
    return { text: logFor(modules.length - (previous ? 1 : 0)) };
  },
};
