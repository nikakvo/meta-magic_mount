<script>
  import { onMount } from "svelte";
  import { device } from "@lib/device.svelte.js";
  import { readLog } from "@lib/api.js";
  import { logWrittenAt } from "@lib/parse.js";
  import { t } from "@lib/strings.js";

  const LEVEL = /^\[(DEBUG|INFO|WARN|ERROR)\]\s*/;

  let which = $state("current");
  let wrap = $state(true);
  let problemsOnly = $state(false);
  let raw = $state("");
  let disabled = $state(false);
  let loading = $state(true);
  let error = $state(null);
  let readAt = $state(null);

  const fmtTime = (d) => d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  // null when no reliable time exists: the part is left out, never guessed
  const writtenAt = $derived(
    device.overview
      ? logWrittenAt({
          previous: which === "previous",
          status: device.overview.status,
          statusOld: device.overview.statusOld,
          bootId: device.overview.bootId,
          uptime: device.overview.uptime,
          now: device.overview.now,
        })
      : null,
  );
  const fmtWhen = (sec) => {
    const d = new Date(sec * 1000);
    const today = new Date().toDateString() === d.toDateString();
    return today
      ? `today ${fmtTime(d)}`
      : `${d.toLocaleDateString([], { day: "numeric", month: "short" })} ${fmtTime(d)}`;
  };

  const lines = $derived(
    raw
      .split("\n")
      .filter((l) => l.length)
      .map((l) => {
        const m = l.match(LEVEL);
        return { level: m ? m[1].toLowerCase() : "info", text: m ? l.slice(m[0].length) : l };
      }),
  );
  const warns = $derived(lines.filter((l) => l.level === "warn").length);
  const errs = $derived(lines.filter((l) => l.level === "error").length);
  const statsLine = $derived(
    [
      writtenAt ? t.logs.written(fmtWhen(writtenAt)) : null,
      t.logs.stats(lines.length, warns, errs),
      readAt ? t.logs.read(fmtTime(readAt)) : null,
    ]
      .filter(Boolean)
      .join(" · "),
  );
  const shown = $derived(problemsOnly ? lines.filter((l) => l.level === "warn" || l.level === "error") : lines);

  async function load() {
    loading = true;
    error = null;
    try {
      if (!device.overview) await device.refresh();
      const r = await readLog(device.config.logfile, which === "previous");
      raw = r.text;
      disabled = r.disabled;
      readAt = new Date();
    } catch (e) {
      console.error(e);
      raw = "";
      error = t.logs.readError;
    } finally {
      loading = false;
    }
  }

  function pick(w) {
    if (w === which) return;
    which = w;
    raw = "";
    load();
  }

  onMount(load);
</script>

<div class="view">
  <section class="sheet">
    <header class="sheet-head"><h2>{t.logs.title}</h2></header>

    <div class="log-tools">
      <div class="seg" role="group" aria-label={t.logs.title}>
        <button type="button" class:on={which === "current"} aria-pressed={which === "current"} onclick={() => pick("current")}>
          {t.logs.current}
        </button>
        <button type="button" class:on={which === "previous"} aria-pressed={which === "previous"} onclick={() => pick("previous")}>
          {t.logs.previous}
        </button>
      </div>
      <button type="button" class="btn" disabled={loading} onclick={load}>
        {loading ? t.logs.refreshing : t.logs.refresh}
      </button>
    </div>

    <div class="log-opts">
      <label class="check"><input type="checkbox" bind:checked={wrap} /> {t.logs.wrap}</label>
      <label class="check"><input type="checkbox" bind:checked={problemsOnly} /> {t.logs.problems}</label>
    </div>

    {#if error}
      <p class="msg bad">{error}</p>
    {:else if loading && !raw}
      <p class="msg">{t.loading}</p>
    {:else if disabled}
      <p class="msg">{t.logs.disabled}</p>
    {:else if !lines.length}
      <p class="msg">{t.logs.empty}</p>
    {:else}
      <p class="log-stats">{statsLine}</p>
      {#if !shown.length}
        <p class="msg ok">{t.logs.noProblems}</p>
      {:else}
        <div class="log" class:wrap>
          {#each shown as l}<div class="ln lv-{l.level}">{l.text}</div>{/each}
        </div>
      {/if}
    {/if}
  </section>
</div>
