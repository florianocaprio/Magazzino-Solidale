import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export interface UnsavedChangesGuard {
  dialogOpen: boolean;
  requestClose: (close: () => void) => void;
  cancelDiscard: () => void;
  confirmDiscard: () => void;
}

export function useUnsavedChangesGuard(isDirty: boolean): UnsavedChangesGuard {
  const [pendingClose, setPendingClose] = useState<(() => void) | null>(null);

  useEffect(() => {
    if (!isDirty) setPendingClose(null);
  }, [isDirty]);

  useEffect(() => {
    if (!isDirty) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);

  const requestClose = useCallback(
    (close: () => void) => {
      if (isDirty) {
        setPendingClose(() => close);
      } else {
        close();
      }
    },
    [isDirty],
  );

  const cancelDiscard = useCallback(() => setPendingClose(null), []);
  const confirmDiscard = useCallback(() => {
    const close = pendingClose;
    setPendingClose(null);
    close?.();
  }, [pendingClose]);

  return {
    dialogOpen: pendingClose !== null,
    requestClose,
    cancelDiscard,
    confirmDiscard,
  };
}

export function UnsavedChangesDialog({
  guard,
}: {
  guard: UnsavedChangesGuard;
}) {
  const { t } = useTranslation();
  return (
    <AlertDialog open={guard.dialogOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("common.unsavedChanges")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("common.unsavedChangesDesc")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={guard.cancelDiscard}>
            {t("common.stayAndEdit")}
          </AlertDialogCancel>
          <AlertDialogAction onClick={guard.confirmDiscard}>
            {t("common.discardChanges")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
