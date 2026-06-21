import { useEffect, useRef } from "react";
import { register, unregister, type BackHandle } from "./backStack.js";

// While `open`, ensures the system Back button closes this overlay (via the
// shared backStack manager) instead of navigating. `onClose` is held in a ref
// so the manager always invokes the latest closure.
export function useBackClose(open: boolean, onClose: () => void): void {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const handle: BackHandle = { onClose: () => onCloseRef.current() };
    register(handle);
    return () => unregister(handle);
  }, [open]);
}
