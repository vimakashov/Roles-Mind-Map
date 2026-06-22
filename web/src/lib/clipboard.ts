/**
 * Copy text to the clipboard in a way that works across browsers.
 *
 * Safari/WebKit is stricter than Chrome about the async Clipboard API
 * (unavailable outside secure contexts, and historically flaky on iOS /
 * older macOS Safari). When `navigator.clipboard.writeText` is missing or
 * rejects, we fall back to the synchronous `document.execCommand("copy")`
 * path, which Safari honours inside a user gesture. Returns whether the
 * copy succeeded so callers can give feedback instead of failing silently.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the legacy path (e.g. Safari permission rejection).
    }
  }
  return legacyCopy(text);
}

/** Synchronous copy via a hidden, selected textarea. Must run inside a user gesture. */
function legacyCopy(text: string): boolean {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.top = "0";
  ta.style.left = "0";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  // iOS Safari ignores select() on a readonly textarea; an explicit range works.
  ta.setSelectionRange(0, text.length);
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  document.body.removeChild(ta);
  return ok;
}
