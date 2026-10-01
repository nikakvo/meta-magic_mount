<script>
  import { device } from "@lib/device.svelte.js";
  import { t } from "@lib/strings.js";
  import TopBar from "@comp/TopBar.svelte";
  import ModulesView from "@comp/ModulesView.svelte";
  import ConfigView from "@comp/ConfigView.svelte";
  import LogsView from "@comp/LogsView.svelte";

  const tabs = [
    { key: "modules", label: t.tabs.modules, component: ModulesView },
    { key: "config", label: t.tabs.config, component: ConfigView },
    { key: "logs", label: t.tabs.logs, component: LogsView },
  ];

  let active = $state("modules");
  let main;
  const View = $derived(tabs.find((x) => x.key === active).component);

  function open(key) {
    if (key === active) return;
    active = key;
    if (main) main.scrollTop = 0;
  }
</script>

<div class="app-root">
  <TopBar />
  <main class="app-main" bind:this={main}>
    {#key active}
      <View />
    {/key}
  </main>
  <nav class="tab-bar">
    {#each tabs as tab (tab.key)}
      <button
        type="button"
        class="tab-btn"
        class:active={active === tab.key}
        aria-current={active === tab.key ? "page" : undefined}
        onclick={() => open(tab.key)}
      >
        {tab.label}
        {#if tab.key === "modules" && device.pendingCount + (device.configPending ? 1 : 0) > 0}
          <span class="tab-dot" aria-hidden="true"></span>
        {/if}
      </button>
    {/each}
  </nav>
</div>
