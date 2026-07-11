"use client";

import { useEffect, useId, useRef } from "react";

const SUPPORTED_TONES = new Set(["neutral", "warning", "danger"]);

function getFocusableElements(container) {
  if (!container) return [];

  return Array.from(
    container.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => !element.hasAttribute("hidden") && element.getAttribute("aria-hidden") !== "true");
}

export default function ConfirmActionDialog({
  open = false,
  title = "Confirmar ação",
  description = "",
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  tone = "danger",
  busy = false,
  onConfirm,
  onCancel,
  children,
}) {
  const dialogRef = useRef(null);
  const cancelButtonRef = useRef(null);
  const previousFocusRef = useRef(null);
  const titleId = useId();
  const descriptionId = useId();
  const resolvedTone = SUPPORTED_TONES.has(tone) ? tone : "neutral";

  useEffect(() => {
    if (!open) return undefined;

    const body = document.body;
    const root = document.documentElement;
    const previousBodyOverflow = body.style.overflow;
    const previousBodyPaddingRight = body.style.paddingRight;
    const previousRootOverflow = root.style.overflow;
    const scrollbarGap = Math.max(0, window.innerWidth - root.clientWidth);

    if (scrollbarGap > 0) {
      const currentPaddingRight = Number.parseFloat(window.getComputedStyle(body).paddingRight) || 0;
      body.style.paddingRight = `${currentPaddingRight + scrollbarGap}px`;
    }
    body.style.overflow = "hidden";
    root.style.overflow = "hidden";

    previousFocusRef.current = document.activeElement;
    const frame = window.requestAnimationFrame(() => cancelButtonRef.current?.focus());

    return () => {
      window.cancelAnimationFrame(frame);
      body.style.overflow = previousBodyOverflow;
      body.style.paddingRight = previousBodyPaddingRight;
      root.style.overflow = previousRootOverflow;
      const previousFocus = previousFocusRef.current;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus();
      }
      previousFocusRef.current = null;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        if (!busy) {
          event.preventDefault();
          onCancel?.();
        }
        return;
      }

      if (event.key !== "Tab") return;

      const focusableElements = getFocusableElements(dialogRef.current);
      if (focusableElements.length === 0) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [busy, onCancel, open]);

  if (!open) return null;

  const handleBackdropMouseDown = (event) => {
    if (!busy && event.target === event.currentTarget) {
      onCancel?.();
    }
  };

  const handleCancel = () => {
    if (!busy) onCancel?.();
  };

  const handleConfirm = () => {
    if (!busy) onConfirm?.();
  };

  return (
    <div className="confirm-dialog-backdrop" onMouseDown={handleBackdropMouseDown}>
      <div
        ref={dialogRef}
        className={`confirm-dialog confirm-dialog--${resolvedTone}${busy ? " confirm-dialog--busy" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        aria-busy={busy}
        tabIndex={-1}
      >
        <div className="confirm-dialog-content">
          <h2 id={titleId} className="confirm-dialog-title">
            {title}
          </h2>
          {description ? (
            <p id={descriptionId} className="confirm-dialog-description">
              {description}
            </p>
          ) : null}
          {children ? <div className="confirm-dialog-body">{children}</div> : null}
        </div>

        <div className="confirm-dialog-actions">
          <button
            ref={cancelButtonRef}
            type="button"
            className="confirm-dialog-cancel"
            aria-disabled={busy}
            onClick={handleCancel}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className="confirm-dialog-confirm"
            data-tone={resolvedTone}
            disabled={busy}
            onClick={handleConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
