<script>
  import { device } from "@lib/device.svelte.js";
  import Logo from "./Logo.svelte";

  const rootNames = { KSU: "KernelSU", APATCH: "APatch" };
  const version = $derived(device.overview?.version || "");
  const root = $derived(device.overview?.root || "");
</script>

<header class="top-bar">
  <div class="brand-wrap">
    <Logo busy={device.loading || device.conflictsLoading} />
    <h1 class="brand">Magic Mount</h1>
  </div>
  <div class="env">
    {#if version}<span>{version}</span>{/if}
    {#if root}<span>{rootNames[root] || root}</span>{/if}
    <a class="help-link" href="help.html">Help</a>
  </div>
</header>
