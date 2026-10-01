// Unit tests for the pure logic in src/lib/parse.js.
// Run: pnpm test   (or: node --test tests/*.test.js)

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CLOCK_FLOOR,
  parseStatus,
  parseUptime,
  logWrittenAt,
  parseConfig,
  statusIsCurrent,
  parseDryRun,
  groupConflicts,
  preferModule,
  serializeConfig,
  validateConfig,
  parseOtherMounters,
} from "../src/lib/parse.js";

const BOOT = "3f1c9a52-8d0e-4c1f-9b7a-2e6d5c4b3a21";
const PREV = "9b0e7d11-0000-4c1f-9b7a-000000000001";
const NOW = 1790000000; // 2026-09-21, a set clock

const status = (extra = "") =>
  parseStatus(
    `boot_id=${BOOT}\nresult=ok\nexit_code=0\nroot=KSU\nversion=v1.1.6\nstart_cs=734\nend_cs=746\n${extra}`,
  );
const statusOld = (extra = "") =>
  parseStatus(`boot_id=${PREV}\nresult=ok\nexit_code=0\nstart_cs=700\nend_cs=725\n${extra}`);

test("parseUptime", () => {
  assert.equal(parseUptime("1234.56 2345.67\n"), 1234.56);
  assert.equal(parseUptime("99"), 99);
  assert.equal(parseUptime(""), null);
  assert.equal(parseUptime("garbage"), null);
  assert.equal(parseUptime(undefined), null);
});

test("parseStatus reads boot_start, missing -> null", () => {
  assert.equal(status().bootStart, null);
  assert.equal(status("boot_start=1789990000").bootStart, 1789990000);
  assert.equal(status("boot_start=").bootStart, null);
  assert.equal(parseStatus(""), null);
});

test("this boot: boot start from now - uptime, plus end_cs", () => {
  const at = logWrittenAt({ status: status(), bootId: BOOT, uptime: 1800, now: NOW });
  assert.equal(at, NOW - 1800 + 7.46);
});

test("this boot: falls back to start_cs when end_cs is missing", () => {
  const st = parseStatus(`boot_id=${BOOT}\nresult=ok\nstart_cs=500\n`);
  assert.equal(logWrittenAt({ status: st, bootId: BOOT, uptime: 100, now: NOW }), NOW - 100 + 5);
});

test("mm.log when Magic Mount did not run this boot: that older boot's boot_start", () => {
  const old = parseStatus(`boot_id=${PREV}\nresult=ok\nstart_cs=700\nend_cs=725\nboot_start=1789900000\n`);
  assert.equal(logWrittenAt({ status: old, bootId: BOOT, uptime: 100, now: NOW }), 1789900000 + 7.25);
});

test("this boot: no time when status belongs to another boot without boot_start, or is missing", () => {
  assert.equal(logWrittenAt({ status: status(), bootId: PREV, uptime: 100, now: NOW }), null);
  assert.equal(logWrittenAt({ status: null, bootId: BOOT, uptime: 100, now: NOW }), null);
  assert.equal(logWrittenAt({ status: status(), bootId: "", uptime: 100, now: NOW }), null);
});

test("this boot: no time without uptime, before the clock is set, or for missing-binary", () => {
  assert.equal(logWrittenAt({ status: status(), bootId: BOOT, uptime: null, now: NOW }), null);
  assert.equal(logWrittenAt({ status: status(), bootId: BOOT, uptime: 100, now: 400000 }), null);
  const mb = parseStatus(`boot_id=${BOOT}\nresult=missing-binary\nexit_code=127\nstart_cs=700\nend_cs=701\n`);
  assert.equal(logWrittenAt({ status: mb, bootId: BOOT, uptime: 100, now: NOW }), null);
});

test("this boot: end_cs later than uptime is impossible -> no time", () => {
  assert.equal(logWrittenAt({ status: status(), bootId: BOOT, uptime: 5, now: NOW }), null);
});

test("previous boot: boot_start from status.old plus end_cs", () => {
  const at = logWrittenAt({
    previous: true,
    status: status(),
    statusOld: statusOld("boot_start=1789900000"),
    bootId: BOOT,
    uptime: 100,
    now: NOW,
  });
  assert.equal(at, 1789900000 + 7.25);
});

test("previous boot: no time without status.old or boot_start (first boot after update, service.sh timed out)", () => {
  const base = { previous: true, status: status(), bootId: BOOT, uptime: 100, now: NOW };
  assert.equal(logWrittenAt({ ...base, statusOld: null }), null);
  assert.equal(logWrittenAt({ ...base, statusOld: statusOld() }), null);
});

test("previous boot: rejects a record of the current boot and a pre-clock boot_start", () => {
  const base = { previous: true, status: status(), uptime: 100, now: NOW };
  const same = parseStatus(`boot_id=${BOOT}\nstart_cs=1\nend_cs=2\nboot_start=1789900000\n`);
  assert.equal(logWrittenAt({ ...base, bootId: BOOT, statusOld: same }), null);
  assert.equal(
    logWrittenAt({ ...base, bootId: BOOT, statusOld: statusOld(`boot_start=${CLOCK_FLOOR - 1}`) }),
    null,
  );
});

test("existing behaviour unchanged: config parse and current-boot check", () => {
  const cfg = parseConfig("LOG_FILE = /x/mm.log\ndebug=yes\npartitions=mi_ext, my_stock\n");
  assert.equal(cfg.logfile, "/x/mm.log");
  assert.equal(cfg.verbose, true);
  assert.deepEqual(cfg.partitions, ["mi_ext", "my_stock"]);
  assert.equal(statusIsCurrent(status(), BOOT), true);
  assert.equal(statusIsCurrent(status(), PREV), false);
});

// ---- v1.2.0: conflicts and mount order ----

const DRY = [
  "mmd-dry-run\t1\tv1.2.0",
  "order\t1\tb-mod\tinstalled",
  "order\t2\ta-mod\tupdate",
  "conflict\tfile\tsystem/etc/hosts\tb-mod\ta-mod",
  "conflict\ttype\tsystem/etc/foo\tb-mod\ta-mod",
  "conflict\tsame\tsystem/etc/x\tb-mod\ta-mod",
  "conflict\treplace\tsystem/app/Foo\ta-mod\tb-mod",
  "unreadable\tc-mod",
  "result\tok\t2\t4",
].join("\n");

test("parseDryRun", () => {
  const r = parseDryRun(DRY);
  assert.equal(r.result, "ok");
  assert.deepEqual(r.order, [
    { id: "b-mod", pending: false },
    { id: "a-mod", pending: true },
  ]);
  assert.equal(r.conflicts.length, 4);
  assert.deepEqual(r.unreadable, ["c-mod"]);
  assert.equal(parseDryRun("garbage"), null);
  assert.equal(parseDryRun(""), null);
});

test("groupConflicts", () => {
  const g = groupConflicts(parseDryRun(DRY).conflicts);
  assert.equal(g.pairs.length, 1);
  assert.equal(g.pairs[0].winner, "b-mod");
  assert.deepEqual(
    g.pairs[0].items.map((i) => i.path),
    ["system/etc/foo", "system/etc/hosts"],
  );
  assert.equal(g.replaces.length, 1);
  assert.equal(g.same, 1);
  assert.deepEqual(groupConflicts(undefined), { pairs: [], replaces: [], same: 0 });
});

test("preferModule moves the id to the front, once", () => {
  assert.deepEqual(preferModule([], "a"), ["a"]);
  assert.deepEqual(preferModule(["b", "a", "c"], "a"), ["a", "b", "c"]);
  assert.deepEqual(preferModule(undefined, "a"), ["a"]);
});

test("priority survives a config round trip", () => {
  const cfg = parseConfig("module_dir=/data/adb/modules\npriority = b-mod, a-mod\n");
  assert.deepEqual(cfg.priority, ["b-mod", "a-mod"]);
  const text = serializeConfig(cfg);
  assert.match(text, /^priority=b-mod,a-mod$/m);
  assert.deepEqual(parseConfig(text).priority, ["b-mod", "a-mod"]);
  assert.doesNotMatch(serializeConfig(parseConfig("")), /priority/);
});

test("validateConfig checks preferred module ids", () => {
  const t = new Proxy({}, { get: (_, k) => (k === "moduleId" || k.startsWith("part") ? (x) => `${k}:${x}` : k) });
  const form = {
    moduledir: "/data/adb/modules",
    tempdir: "",
    logfile: "",
    mountsource: "KSU",
    partitions: "",
    priority: "good-id, bad/id",
  };
  assert.equal(validateConfig(form, t).priority, "moduleId:bad/id");
  assert.equal(validateConfig({ ...form, priority: "a, b.c_d-e" }, t).priority, undefined);
});

test("parseOtherMounters", () => {
  assert.deepEqual(parseOtherMounters("mountify\tMountify\nmeta-overlayfs\t\n"), [
    { id: "mountify", name: "Mountify" },
    { id: "meta-overlayfs", name: "meta-overlayfs" },
  ]);
});
