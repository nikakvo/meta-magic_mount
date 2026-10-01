<script>
  let { parts = [], muted = false } = $props();
</script>

<span class="strata" class:muted aria-hidden="true">
  {#each parts as part}
    <span class="band part-{part}"></span>
  {/each}
</span>
