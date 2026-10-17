<script>
  import { device } from "@lib/device.svelte.js";
  import { whichPath } from "@lib/api.js";
  import { isLookupPath } from "@lib/parse.js";
  import { t } from "@lib/strings.js";

  let path = $state("");
  let report = $state(null);
  let asked = $state("");
  let busy = $state(false);
  let message = $state(null);

  const names = $derived(new Map(device.modules.map((m) => [m.id, m.name])));
  const name = (id) => names.get(id) || id;

  const headline = $derived.by(() => {
    if (!report) return null;
    if (report.result === "used" && report.winner) return { cls: "ok", text: t.which.used(name(report.winner)) };
    if (report.result === "merged") return { cls: "ok", text: t.which.merged };
    if (report.result === "none")
      return { cls: "", text: report.modules.length ? t.which.noneUsed : t.which.none };
    return { cls: "bad", text: t.which.error };
  });

  async function lookup(event) {
    event?.preventDefault();
    const p = path.trim();
    message = null;
    if (!isLookupPath(p)) {
      report = null;
      message = t.which.invalid;
      return;
    }
    busy = true;
    try {
      report = await whichPath(p);
      asked = p;
    } catch (e) {
      console.error(e);
      report = null;
      message = t.which.error;
    } finally {
      busy = false;
    }
  }
</script>

<section class="sheet" aria-busy={busy}>
  <header class="sheet-head">
    <h2>{t.which.title}</h2>
    <p class="help">{t.which.intro}</p>
  </header>

  <form class="which-form" onsubmit={lookup}>
    <input
      class="mono"
      type="text"
      placeholder={t.which.placeholder}
      autocapitalize="off"
      autocomplete="off"
      spellcheck="false"
      aria-label={t.which.title}
      bind:value={path}
    />
    <button type="submit" class="btn" disabled={busy || !path.trim()}>
      {busy ? t.which.looking : t.which.lookup}
    </button>
  </form>

  {#if message}<p class="msg bad">{message}</p>{/if}

  {#if report && headline}
    <p class="which-path mono">{asked}</p>
    <p class="msg {headline.cls}">{headline.text}</p>
    {#if report.modules.length}
      <ul class="cf-list">
        {#each report.modules as m (m.id)}
          <li class="cf which-row">
            <p class="cf-head"><strong>{name(m.id)}</strong> <span class="mono which-id">{m.id}</span></p>
            <p class="help">
              <span class="which-st which-{m.status}">{t.which.status[m.status] || m.status}</span>
              · {t.which.types[m.type] || m.type}{#if m.pending} · {t.which.pending}{/if}
            </p>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</section>
