<script>
  // Animated mark: partition-colored rings turning around a stack of layers,
  // the picture of module files being mounted over the system. Spins faster
  // while the interface is reading from the device.
  let { busy = false } = $props();
</script>

<svg class="logo" class:busy viewBox="0 0 40 40" aria-hidden="true" focusable="false">
  <!-- extra turn while busy; paused (not reset) otherwise, so no jumps -->
  <g class="ring boost">
  <!-- outer ring: system -->
  <g class="ring r1">
    <circle cx="20" cy="20" r="17.5" class="track-c" />
    <circle cx="20" cy="20" r="17.5" class="arc" stroke="var(--p-system)" stroke-dasharray="22 5.5" />
    <circle cx="20" cy="2.5" r="1.9" fill="var(--brass)" />
  </g>
  <!-- middle ring: vendor / product -->
  <g class="ring r2">
    <circle cx="20" cy="20" r="13" class="arc" stroke="var(--p-vendor)" stroke-dasharray="14 6.4" />
  </g>
  <g class="ring r3">
    <circle cx="20" cy="20" r="9.2" class="arc thin" stroke="var(--p-product)" stroke-dasharray="4 3.2" />
  </g>
  </g>
  <!-- core: three layers sliding into place -->
  <g class="core">
    <rect class="l l1" x="14.2" y="14.6" width="11.6" height="2.4" rx="1.2" fill="var(--p-system)" />
    <rect class="l l2" x="14.2" y="18.8" width="11.6" height="2.4" rx="1.2" fill="var(--p-vendor)" />
    <rect class="l l3" x="14.2" y="23" width="11.6" height="2.4" rx="1.2" fill="var(--brass)" />
  </g>
</svg>

<style>
  .logo {
    width: 30px;
    height: 30px;
    flex: none;
    overflow: visible;
  }
  .track-c {
    fill: none;
    stroke: var(--rule);
    stroke-width: 1;
  }
  .arc {
    fill: none;
    stroke-width: 2.2;
    stroke-linecap: round;
  }
  .arc.thin {
    stroke-width: 1.6;
  }
  .ring,
  .l {
    transform-origin: 20px 20px;
  }
  .r1 {
    animation: spin 14s linear infinite;
  }
  .r2 {
    animation: spin 9s linear infinite reverse;
  }
  .r3 {
    animation: spin 5s linear infinite;
  }
  .l {
    animation: slide 4.2s ease-in-out infinite;
  }
  .l2 {
    animation-delay: 0.25s;
  }
  .l3 {
    animation-delay: 0.5s;
  }
  .boost {
    animation: spin 1.3s linear infinite paused;
  }
  /* reading from the device */
  .busy .boost {
    animation-play-state: running;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  @keyframes slide {
    0%,
    55%,
    100% {
      transform: translateX(0);
      opacity: 1;
    }
    70% {
      transform: translateX(-3px);
      opacity: 0.55;
    }
    85% {
      transform: translateX(2px);
      opacity: 1;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .ring,
    .l {
      animation: none;
    }
  }
</style>
