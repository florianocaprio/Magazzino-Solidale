import { cloneElement, useEffect, useId, type ReactElement } from "react";
import { useTranslation } from "react-i18next";

/** Collega le validazioni imperative esistenti, senza introdurre nuove regole di dominio. */
export function RequiredField({
  missing,
  label,
  children,
}: {
  missing: boolean;
  label: string;
  children: ReactElement<Record<string, unknown>>;
}) {
  const id = useId(),
    { t } = useTranslation();
  useEffect(() => {
    if (!missing) return;
    const frame = requestAnimationFrame(() => {
      const control = document.getElementById(id);
      const scope = control?.closest('form,[role="dialog"],[role="region"]');
      if (scope?.querySelector('[aria-invalid="true"]') === control) {
        control?.focus();
        control?.scrollIntoView?.({ block: "nearest" });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [missing, id]);
  const described =
    [children.props["aria-describedby"], missing ? id + "-error" : null]
      .filter(Boolean)
      .join(" ") || undefined;
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label} *
      </label>
      {cloneElement(children, {
        id,
        "aria-invalid": missing || children.props["aria-invalid"],
        "aria-describedby": described,
      })}
      {missing && (
        <p id={id + "-error"} className="text-sm text-destructive">
          {t("common.requiredField")}
        </p>
      )}
    </div>
  );
}
