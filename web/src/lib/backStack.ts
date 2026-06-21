// Centralised browser-history guard so the system Back button closes the
// top-most open overlay instead of navigating. See
// docs/superpowers/specs/2026-06-21-close-modals-on-back-button-design.md.

export interface BackHandle {
  onClose: () => void;
}

const MARKER = "rmmModal";

let stack: BackHandle[] = [];
let pushed = 0; // sentinels we believe are in window.history
let guardedPops = 0; // self-induced popstate echoes still to be swallowed
let scheduled = false;
let listening = false;

function onPopState() {
  if (guardedPops > 0) {
    // Our own history.go(-n) echo — ignore. `guardedPops` is a count, not a
    // tagged token, so a real Back press landing in the few-ms window between
    // a programmatic close's history.go and the browser's async echo is
    // knowingly absorbed here. Accepted per the design spec ("Close + navigate":
    // worst case is one extra/missed Back, which is harmless).
    guardedPops--;
    return;
  }
  if (pushed > 0) {
    pushed--;
    const top = stack.pop();
    top?.onClose();
  }
}

function reconcile() {
  scheduled = false;
  if (typeof window === "undefined") return;
  const desired = stack.length;
  if (desired > pushed) {
    for (let i = pushed; i < desired; i++) {
      window.history.pushState({ ...window.history.state, [MARKER]: i + 1 }, "");
    }
    pushed = desired;
  } else if (desired < pushed) {
    const n = pushed - desired;
    guardedPops += n;
    pushed = desired;
    window.history.go(-n);
  }
}

function scheduleReconcile() {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(reconcile);
}

function ensureListener() {
  if (listening || typeof window === "undefined") return;
  window.addEventListener("popstate", onPopState);
  listening = true;
}

export function register(handle: BackHandle): void {
  ensureListener();
  stack.push(handle);
  scheduleReconcile();
}

export function unregister(handle: BackHandle): void {
  const i = stack.indexOf(handle);
  if (i === -1) return; // already popped by a Back press — idempotent
  stack.splice(i, 1);
  scheduleReconcile();
}

// Test-only: reset the stack and counters between tests. Leaves the single
// popstate listener in place (it reads module state on each event).
export function __resetBackStack(): void {
  stack = [];
  pushed = 0;
  guardedPops = 0;
  scheduled = false;
}
