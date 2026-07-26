"use client";

import { useEffect, useRef } from "react";

/**
 * The browser's native "Please fill in this field" validation bubble is localized to the
 * browser's own UI language (Accept-Language/OS setting), not this page's `lang` — so a
 * learner using the zh/es interface who leaves a required field blank still sees an
 * English bubble on an otherwise fully-localized page. `setCustomValidity` replaces that
 * bubble's text (the native bubble itself, positioning, and timing all stay exactly the
 * same) with real page-language copy — cleared on `input` so a corrected value doesn't
 * stay blocked by a stale custom message. Renders nothing; wire it inside the `<form>`
 * whose required fields need localized messages.
 */
export function RequiredFieldMessages({ message }: { message: string }) {
  const messageRef = useRef(message);
  // Refs can't be written during render (see useRef's docs) — this keeps the ref in sync
  // for the `invalid` handler below (registered once, so it can't just close over
  // `message` directly) without ever reading/writing `.current` mid-render.
  useEffect(() => {
    messageRef.current = message;
  }, [message]);

  const containerRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const form = containerRef.current?.closest("form");
    if (!form) return;

    function handleInvalid(event: Event) {
      const field = event.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
      if (field.validity.valueMissing) field.setCustomValidity(messageRef.current);
    }
    function handleInput(event: Event) {
      (event.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).setCustomValidity("");
    }

    const fields = form.querySelectorAll("input, textarea, select");
    fields.forEach((field) => {
      field.addEventListener("invalid", handleInvalid);
      field.addEventListener("input", handleInput);
      field.addEventListener("change", handleInput);
    });
    return () => {
      fields.forEach((field) => {
        field.removeEventListener("invalid", handleInvalid);
        field.removeEventListener("input", handleInput);
        field.removeEventListener("change", handleInput);
      });
    };
  }, []);

  return <span ref={containerRef} hidden />;
}
