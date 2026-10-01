<script>
  import { device } from "@lib/device.svelte.js";
  import { saveConfig } from "@lib/api.js";
  import { groupConflicts, preferModule } from "@lib/parse.js";
  import { t } from "@lib/strings.js";

  let saving = $state(false);
  let saveError = $state(null);

  const report = $derived(device.conflicts);
  const groups = $derived(groupConflicts(report?.conflicts));
  const names = $derived(new Map(device.modules.map((m) => [m.id, m.name])));
  const name = (id) => names.get(id) || id;
  const priority = $derived(device.config.priority || []);
  const apatch = $derived(device.overview?.root === "APATCH");
  const clean = $derived(
    report && !groups.pairs.length && !groups.replaces.length && !report.unreadable.length,
  );

  async function setOrder(list) {
    if (saving) return;
    saving = true;
    saveError = null;
    try {
      await saveConfig({ ...device.config, priority: list }, { omitUmount: apatch });
      await device.refresh(); // re-runs the conflict check with the new order
    } catch (e) {
      console.error(e);
      saveError = t.conflicts.preferError;
    } finally {
      saving = false;
    }
  }
</script>

<section class="sheet" aria-busy={device.conflictsLoading}>
  <header class="sheet-head">
    <h2>{t.conflicts.title}</h2>
    <p class="help">{t.conflicts.intro}</p>
  </header>

  {#if report?.others?.length}
    <div class="cf-warn" role="alert">
      <p>{t.conflicts.others}</p>
      <ul>
        {#each report.others as o (o.id)}
          <li><span>{o.name}</span> <span class="mono">{o.id}</span></li>
        {/each}
      </ul>
      <p class="help">{t.conflicts.othersHelp}</p>
    </div>
  {/if}

  {#if device.conflictsError && !report}
    <p class="msg bad">{t.conflicts.error}</p>
  {:else if !report}
    <p class="msg">{t.conflicts.checking}</p>
  {:else if clean}
    <p class="msg ok">{t.conflicts.none}</p>
  {:else}
    {#if groups.pairs.length}
      <ul class="cf-list">
        {#each groups.pairs as g (g.winner + "\t" + g.loser)}
          <li class="cf">
            <p class="cf-head">
              <strong>{name(g.winner)}</strong>
              {t.conflicts.usedOver}
              <strong>{name(g.loser)}</strong>
            </p>
            <details class="cf-files">
              <summary>{t.conflicts.entries(g.items.length)} · {t.conflicts.showFiles}</summary>
              <ul class="mono">
                {#each g.items as it (it.path)}
                  <li>
                    {it.path}{#if it.kind === "type"}<span class="cf-kind">{t.conflicts.kindType}</span>{/if}
                  </li>
                {/each}
              </ul>
            </details>
            <button
              type="button"
              class="btn cf-btn"
              disabled={saving}
              onclick={() => setOrder(preferModule(priority, g.loser))}
            >
              {t.conflicts.prefer(name(g.loser))}
            </button>
          </li>
        {/each}
      </ul>
    {/if}

    {#each groups.replaces as r (r.path + r.winner + r.loser)}
      <p class="cf-note">
        <strong>{name(r.winner)}</strong>
        {t.conflicts.empties}
        <span class="mono">{r.path}</span>.
        {t.conflicts.replaceNote(name(r.loser))}
      </p>
    {/each}

    {#if report.unreadable.length}
      <p class="msg bad">{t.conflicts.unreadable}</p>
      <ul class="boot-list">
        {#each report.unreadable as id}<li class="mono">{id}</li>{/each}
      </ul>
    {/if}
  {/if}

  {#if report && groups.same > 0}
    <p class="help">{t.conflicts.same(groups.same)}</p>
  {/if}

  <footer class="sheet-foot">
    <div class="cf-order">
      <span class="label">{t.conflicts.order}</span>
      {#if priority.length}
        <ol class="mono">
          {#each priority as id}<li>{id}</li>{/each}
        </ol>
        <p class="help">{t.conflicts.orderHelp}</p>
      {:else}
        <p class="help">{t.conflicts.orderNone}</p>
      {/if}
    </div>
    {#if saveError}<p class="msg bad">{saveError}</p>{/if}
    <div class="actions">
      {#if priority.length}
        <button type="button" class="btn" disabled={saving} onclick={() => setOrder([])}>
          {t.conflicts.resetOrder}
        </button>
      {/if}
      <button
        type="button"
        class="btn"
        disabled={device.conflictsLoading || saving}
        onclick={() => device.refreshConflicts()}
      >
        {device.conflictsLoading ? t.conflicts.checking : t.conflicts.recheck}
      </button>
    </div>
  </footer>
</section>
