"use client";

import { useCallback, useState } from "react";
import ConfirmActionDialog from "@/src/components/ui/ConfirmActionDialog";

/**
 * Keeps high-impact dashboard actions behind one consistent confirmation flow.
 * The task is executed only after the operator confirms the summarized effect.
 */
export default function useConfirmAction() {
  const [pendingAction, setPendingAction] = useState(null);
  const [confirming, setConfirming] = useState(false);

  const requestConfirmation = useCallback((action) => {
    if (!action?.task) return;
    setPendingAction((current) => current || action);
  }, []);

  const cancelConfirmation = useCallback(() => {
    if (!confirming) setPendingAction(null);
  }, [confirming]);

  const confirmAction = useCallback(async () => {
    if (!pendingAction?.task || confirming) return;
    setConfirming(true);
    try {
      await pendingAction.task();
    } finally {
      setConfirming(false);
      setPendingAction(null);
    }
  }, [confirming, pendingAction]);

  const confirmationDialog = (
    <ConfirmActionDialog
      open={Boolean(pendingAction)}
      title={pendingAction?.title || "Confirmar ação"}
      description={pendingAction?.description || "Revise a consequência antes de continuar."}
      confirmLabel={pendingAction?.confirmLabel || "Confirmar ação"}
      cancelLabel="Cancelar"
      tone={pendingAction?.tone || "warning"}
      busy={confirming}
      onConfirm={confirmAction}
      onCancel={cancelConfirmation}
    >
      {pendingAction?.detail ? <p>{pendingAction.detail}</p> : null}
    </ConfirmActionDialog>
  );

  return {
    requestConfirmation,
    confirmationDialog,
    confirming,
    confirmationOpen: Boolean(pendingAction),
  };
}
