"use client";

/**
 * Site-wide ⌘K / Ctrl+K host. Tiny: it only listens for the shortcut (and the
 * `agri:command` window event) and lazy-loads the real palette on first use,
 * keeping cmdk + Radix Dialog out of the initial bundle.
 */
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

const CommandPalette = dynamic(() => import("./CommandPalette"), { ssr: false });

import { COMMAND_EVENT } from "./events";
export { COMMAND_EVENT };

/** Open the palette from anywhere (e.g. a nav button). */
export function openCommandPalette() {
  window.dispatchEvent(new CustomEvent(COMMAND_EVENT));
}

export function CommandPaletteHost() {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setLoaded(true);
        setOpen((o) => !o);
      }
    };
    const onEvent = () => {
      setLoaded(true);
      setOpen(true);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener(COMMAND_EVENT, onEvent);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(COMMAND_EVENT, onEvent);
    };
  }, []);

  return loaded ? <CommandPalette open={open} onOpenChange={setOpen} /> : null;
}
