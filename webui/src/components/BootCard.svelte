<script>
  import { device } from "@lib/device.svelte.js";
  import { formatSeconds } from "@lib/parse.js";
  import { t } from "@lib/strings.js";

  // -> { level: ok | warn | bad | idle | none, text, failedModules }
  const view = $derived.by(() => {
    const status = device.overview?.status;
    const s = device.summary;
    const current = device.current;

    if (status && !current) return { level: "bad", text: t.boot.stale };
    if (current && status.result === "missing-binary")
      return { level: "bad", text: t.boot.missingBinary };

    if (current && status.result === "failed") {
      return {
        level: "bad",
        text: t.boot.failed(s?.failedRc ?? status.exitCode),
        failedModules: s?.failedModules || [],
      };
    }

    // A log summary is trusted when it belongs to this boot, or when
    // there are no boot records yet (first boot after updating).
    if (s && (current || !status)) {
      if (s.failedRc !== null)
        return { level: "bad", text: t.boot.failed(s.failedRc), failedModules: s.failedModules };
      if (s.nothing || !s.mounted) return { level: "idle", text: t.boot.empty };
      if (s.failures > 0 || s.skipped > 0)
        return {
          level: "warn",
          text: t.boot.partial(s.mounted, s.failures, s.skipped),
          failedModules: s.failedModules,
        };
      return { level: "ok", text: t.boot.ok(s.mounted, s.modules ?? 0) };
    }

    if (current) return { level: "ok", text: t.boot.okNoLog };
    return { level: "none", text: t.boot.none };
  });

  const timing = $derived.by(() => {
    const st = device.overview?.status;
    if (!device.current || st?.startCs == null || st?.endCs == null) return null;
    const at = formatSeconds(st.startCs);
    const took = formatSeconds(Math.max(0, st.endCs - st.startCs));
    return at && took ? t.boot.timing(at, took) : null;
  });
</script>

{#if device.overview}
  <section class="boot boot-{view.level}" aria-live="polite">
    <h2 class="boot-title">{t.boot.title}</h2>
    <p class="boot-text">{view.text}</p>
    {#if timing}<p class="boot-meta">{timing}</p>{/if}
    {#if view.failedModules?.length}
      <p class="boot-sub">{t.boot.failedModules}</p>
      <ul class="boot-list">
        {#each view.failedModules as id}<li class="mono">{id}</li>{/each}
      </ul>
    {/if}
  </section>
{/if}
