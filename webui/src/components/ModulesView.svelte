<script>
  import { onMount } from "svelte";
  import { device } from "@lib/device.svelte.js";
  import { setMounting } from "@lib/api.js";
  import { mountsNextBoot } from "@lib/parse.js";
  import { t } from "@lib/strings.js";
  import BootCard from "./BootCard.svelte";
  import Strata from "./Strata.svelte";
  import ConflictsCard from "./ConflictsCard.svelte";

  let busy = $state({});
  let errors = $state({});

  const firstLoad = $derived(device.loading && !device.overview);
  const moduleDir = $derived(device.config.moduledir);
  onMount(() => device.refresh());

  async function toggle(m) {
    if (busy[m.id] || m.disabled || m.remove) return;
    const mount = m.skipMount; // currently off -> switch on
    busy[m.id] = true;
    errors[m.id] = null;
    try {
      await setMounting(moduleDir, m.id, mount);
      device.patchModule(m.id, { skipMount: !mount, tracked: !mount });
      device.refreshConflicts();
    } catch (e) {
      console.error(e);
      errors[m.id] = t.modules.toggleError;
    } finally {
      busy[m.id] = false;
    }
  }

  function note(m) {
    if (m.remove) return t.modules.removing;
    if (m.disabled) return t.modules.disabled;
    if (m.skipMount && !m.tracked) return t.modules.external;
    return null;
  }

  const changeText = {
    mount: t.modules.willMount,
    unmount: t.modules.willUnmount,
    update: t.modules.willUpdate,
  };
</script>

<div class="view">
  <BootCard />

  <section class="sheet">
    <header class="sheet-head">
      <h2>{t.modules.title}</h2>
      <p class="help">{t.modules.intro}</p>
    </header>

    {#if device.error && !device.overview}
      <p class="msg bad">{t.modules.loadError}</p>
    {:else if firstLoad}
      <p class="msg">{t.loading}</p>
    {:else if device.rows.length === 0}
      <p class="msg">{t.modules.empty}</p>
    {:else}
      <ul class="mod-list">
        {#each device.rows as m (m.id)}
          {@const on = mountsNextBoot(m)}
          {@const n = note(m)}
          <li class="mod" class:off={!on}>
            <Strata parts={m.parts} muted={!on} />
            <div class="mod-body">
              <span class="mod-name">{m.name}</span>
              <span class="mod-id mono">{m.id}</span>
              <span class="mod-parts">
                {#each m.parts as p}<span class="part-text part-{p}">{p}</span>{/each}
              </span>
              {#if m.change}
                <span class="chip chip-{m.change}">{changeText[m.change]}</span>
              {/if}
              {#if n}<span class="mod-note">{n}</span>{/if}
              {#if errors[m.id]}<span class="mod-note bad">{errors[m.id]}</span>{/if}
            </div>
            <label class="switch">
              <input
                type="checkbox"
                role="switch"
                aria-label={t.modules.toggleLabel(m.name)}
                checked={on}
                disabled={m.disabled || m.remove || busy[m.id]}
                onchange={(e) => {
                  e.currentTarget.checked = on; // state decides, not the click
                  toggle(m);
                }}
              />
              <span class="track"><span class="thumb"></span></span>
            </label>
          </li>
        {/each}
      </ul>
    {/if}

    <footer class="sheet-foot">
      {#if device.pendingCount > 0}
        <p class="msg accent" role="status">{t.modules.pending(device.pendingCount)}</p>
      {/if}
      {#if device.configPending}
        <p class="msg accent" role="status">{t.modules.pendingConfig}</p>
      {/if}
      {#if device.error && device.overview}
        <p class="msg bad">{t.modules.loadError}</p>
      {/if}
      <p class="path"><span>{t.modules.dir}</span> <span class="mono">{moduleDir}</span></p>
      <button type="button" class="btn" disabled={device.loading} onclick={() => device.refresh()}>
        {t.modules.reload}
      </button>
    </footer>
  </section>

  {#if device.overview}
    <ConflictsCard />
  {/if}
</div>
