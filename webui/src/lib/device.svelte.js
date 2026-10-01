// Shared state for all tabs. Lives at module level, so switching tabs
// neither loses it nor changes what "pending" means: pending changes are
// always computed by comparing the device's files with what the current
// boot actually did (status + boot_state + boot_config from metamount.sh).

import { readOverview, listModules, readLog, checkConflicts } from "./api.js";
import {
  DEFAULT_CONFIG,
  statusIsCurrent,
  baselineFromBootState,
  withPending,
  mountsNextBoot,
  parseSummary,
} from "./parse.js";

const norm = (s) =>
  String(s || "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n");

// Fallback baselines for the time before metamount.sh has ever run
// (fresh install, or first boot after updating from a version without
// boot records): "what it was when this app was opened".
let sessionModules = null;
let sessionConfig = null;

class Device {
  overview = $state(null);
  modules = $state([]);
  summary = $state(null);
  loading = $state(true);
  error = $state(null);

  // mmd --dry-run: mount order and conflicts of the next boot
  conflicts = $state(null);
  conflictsLoading = $state(false);
  conflictsError = $state(null);
  _conflictRun = 0;

  config = $derived(this.overview?.config ?? { ...DEFAULT_CONFIG });
  hasRun = $derived(!!this.overview?.status);
  current = $derived(statusIsCurrent(this.overview?.status, this.overview?.bootId));

  baseline = $derived.by(() => {
    if (this.current && this.overview?.bootState) {
      return baselineFromBootState(this.overview.bootState);
    }
    if (!this.hasRun) return sessionModules;
    return null; // did not run this boot: nothing to compare with
  });

  rows = $derived(withPending(this.modules, this.baseline));

  configPending = $derived.by(() => {
    if (!this.overview) return false;
    let before;
    if (this.current) before = this.overview.bootConfigText ?? "";
    else if (!this.hasRun) before = sessionConfig;
    else return false;
    return before !== null && norm(before) !== norm(this.overview.configText);
  });

  pendingCount = $derived(this.rows.filter((m) => m.change).length);

  async refresh() {
    this.loading = true;
    this.error = null;
    try {
      const ov = await readOverview();
      if (sessionConfig === null) sessionConfig = ov.configText;
      const [modules, log] = await Promise.all([
        listModules(ov.config.moduledir, ov.config.partitions),
        readLog(ov.config.logfile).catch(() => ({ text: "", disabled: false })),
      ]);
      if (sessionModules === null) {
        sessionModules = new Map(modules.map((m) => [m.id, mountsNextBoot(m)]));
      }
      this.overview = ov;
      this.modules = modules;
      this.summary = parseSummary(log.text);
    } catch (e) {
      console.error(e);
      this.error = e;
    } finally {
      this.loading = false;
    }
    if (!this.error) this.refreshConflicts();
  }

  // Runs after the main data, so the list shows without waiting for it
  async refreshConflicts() {
    const run = (this._conflictRun = (this._conflictRun || 0) + 1);
    this.conflictsLoading = true;
    this.conflictsError = null;
    try {
      const report = await checkConflicts(this.config.moduledir);
      if (run === this._conflictRun) this.conflicts = report;
    } catch (e) {
      console.error(e);
      if (run === this._conflictRun) this.conflictsError = e;
    } finally {
      if (run === this._conflictRun) this.conflictsLoading = false;
    }
  }

  // Update one module in place after a successful toggle
  patchModule(id, fields) {
    this.modules = this.modules.map((m) => (m.id === id ? { ...m, ...fields } : m));
  }
}

export const device = new Device();
