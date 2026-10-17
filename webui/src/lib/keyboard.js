// Keep a focused text field visible above the on-screen keyboard.
// The WebView shrinks the page when the keyboard opens but does not scroll
// to the field, so a field low on the page ends up behind the keyboard.

function centre(el) {
  if (document.activeElement === el) el.scrollIntoView({ block: "center", behavior: "smooth" });
}

export function keepFieldsVisible() {
  document.addEventListener("focusin", (event) => {
    const el = event.target;
    if (!(el instanceof HTMLInputElement) || el.type !== "text") return;
    const vv = window.visualViewport;
    if (vv) {
      const once = () => {
        vv.removeEventListener("resize", once);
        centre(el);
      };
      vv.addEventListener("resize", once);
      // the keyboard may already be open (moving between fields): no resize then
      setTimeout(() => vv.removeEventListener("resize", once), 1000);
    }
    window.addEventListener("resize", () => centre(el), { once: true });
    setTimeout(() => centre(el), 400);
  });
}
