<script>
  import { onMount } from "svelte";
  import { device } from "@lib/device.svelte.js";
  import { saveConfig, CONFIG_PATH } from "@lib/api.js";
  import { DEFAULT_CONFIG, splitList, validateConfig, serializeConfig } from "@lib/parse.js";
  import { t } from "@lib/strings.js";

  // Raw text of every input, plus the two switches
  let form = $state(toForm(DEFAULT_CONFIG));
  let ready = $state(false);
  let saving = $state(false);
  let flash = $state(null); // { kind, text } after save / on error
  let touched = $state(false); // show validation only after a save attempt

  const apatch = $derived(device.overview?.root === "APATCH");
  const cfg = $derived(fromForm(form));
  const errors = $derived(validateConfig(form, t.config.errors));
  const invalid = $derived(Object.keys(errors).length > 0);
  const dirty = $derived(
    ready && serializeConfig(cfg, { omitUmount: apatch }) !==
      serializeConfig(device.config, { omitUmount: apatch }),
  );

  function toForm(c) {
    return {
      moduledir: c.moduledir || "",
      tempdir: c.tempdir || "",
      mountsource: c.mountsource || "",
      logfile: c.logfile || "",
      partitions: (c.partitions || []).join(", "),
      priority: (c.priority || []).join(", "),
      verbose: !!c.verbose,
      umount: c.umount !== false,
    };
  }

  function fromForm(f) {
    return {
      moduledir: f.moduledir.trim(),
      tempdir: f.tempdir.trim(),
      mountsource: f.mountsource.trim(),
      logfile: f.logfile.trim(),
      partitions: splitList(f.partitions),
      priority: splitList(f.priority),
      verbose: f.verbose,
      umount: f.umount,
    };
  }

  async function load() {
    ready = false;
    flash = null;
    touched = false;
    await device.refresh();
    if (device.error && !device.overview) flash = { kind: "bad", text: t.config.loadError };
    form = toForm(device.config);
    ready = true;
  }

  function discard() {
    form = toForm(device.config);
    touched = false;
    flash = null;
  }

  function defaults() {
    form = toForm(DEFAULT_CONFIG);
    flash = null;
  }

  async function save() {
    touched = true;
    flash = null;
    if (invalid) {
      flash = { kind: "bad", text: t.config.invalid };
      return;
    }
    saving = true;
    try {
      await saveConfig(cfg, { omitUmount: apatch });
      await device.refresh();
      form = toForm(device.config);
      touched = false;
      // the persistent "apply after reboot" line says it already
      flash = device.configPending ? null : { kind: "ok", text: t.config.saved };
    } catch (e) {
      console.error(e);
      flash = { kind: "bad", text: t.config.saveError };
    } finally {
      saving = false;
    }
  }

  onMount(load);

  const err = (key) => (touched ? errors[key] : null);
</script>

{#snippet seg(id, label, value, offLabel, onLabel, set, help)}
  <div class="field">
    <span class="label" id={id}>{label}</span>
    <div class="seg" role="group" aria-labelledby={id}>
      <button type="button" class:on={!value} aria-pressed={!value} onclick={() => set(false)}>
        {offLabel}
      </button>
      <button type="button" class:on={value} aria-pressed={value} onclick={() => set(true)}>
        {onLabel}
      </button>
    </div>
    <p class="help">{help}</p>
  </div>
{/snippet}

{#snippet text(key, label, help, placeholder = "")}
  <div class="field" class:invalid={err(key)}>
    <label class="label" for="f-{key}">{label}</label>
    <input
      id="f-{key}"
      class="mono"
      type="text"
      {placeholder}
      autocapitalize="off"
      autocomplete="off"
      spellcheck="false"
      aria-invalid={!!err(key)}
      bind:value={form[key]}
    />
    {#if err(key)}<p class="help field-error">{err(key)}</p>{/if}
    <p class="help">{help}</p>
  </div>
{/snippet}

<div class="view">
  <section class="sheet">
    <header class="sheet-head"><h2>{t.config.title}</h2></header>

    {#if !ready}
      <p class="msg">{t.loading}</p>
    {:else}
      {@render seg("lbl-level", t.config.logLevel, form.verbose, t.config.normal, t.config.detailed,
        (v) => (form.verbose = v), t.config.logLevelHelp)}
      {#if !apatch}
        {@render seg("lbl-umount", t.config.umount, form.umount, t.config.off, t.config.on,
          (v) => (form.umount = v), t.config.umountHelp)}
      {/if}
      {@render text("partitions", t.config.partitions, t.config.partitionsHelp, "mi_ext, my_stock")}
      {@render text("priority", t.config.priority, t.config.priorityHelp, "module-a, module-b")}
      {@render text("tempdir", t.config.tempDir, t.config.tempDirHelp, "Automatic")}
      {@render text("mountsource", t.config.mountSource, t.config.mountSourceHelp, "KSU")}
      {@render text("logfile", t.config.logFile, t.config.logFileHelp, DEFAULT_CONFIG.logfile)}
      {@render text("moduledir", t.config.moduleDir, t.config.moduleDirHelp, DEFAULT_CONFIG.moduledir)}
    {/if}

    <footer class="sheet-foot">
      {#if flash}
        <p class="msg {flash.kind}" role="status">{flash.text}</p>
      {/if}
      {#if ready && dirty}
        <p class="msg accent">{t.config.unsaved}</p>
      {:else if ready && device.configPending}
        <p class="msg accent">{t.config.pending}</p>
      {/if}
      <div class="actions">
        <button type="button" class="btn" disabled={!ready || saving || !dirty} onclick={discard}>
          {t.config.discard}
        </button>
        <button type="button" class="btn primary" disabled={!ready || saving || !dirty} onclick={save}>
          {saving ? t.config.saving : t.config.save}
        </button>
      </div>
      <button type="button" class="btn link" disabled={!ready || saving} onclick={defaults}>
        {t.config.defaults}
      </button>
      <p class="path"><span>{t.config.path}</span> <span class="mono">{CONFIG_PATH}</span></p>
    </footer>
  </section>
</div>
