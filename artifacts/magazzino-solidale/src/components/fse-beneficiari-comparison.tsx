import { useTranslation } from "react-i18next";
import type { BeneficiariFseComparisonField } from "@workspace/api-client-react";

export function FseBeneficiariComparison({
  fields,
  registered = true,
}: {
  fields: BeneficiariFseComparisonField[];
  registered?: boolean;
}) {
  const { t } = useTranslation();
  const value = (field: BeneficiariFseComparisonField, incoming: boolean) => {
    const text = incoming ? field.importato : field.attuale;
    if (text == null)
      return t(incoming ? "blocco07.notInFile" : "blocco07.notRecorded");
    if (field.campo === "dataNascita" || field.campo === "dataPresaInCarico") {
      const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
      if (parts) return `${parts[3]}/${parts[2]}/${parts[1]}`;
    }
    return text;
  };
  const visible = registered
    ? fields.filter(
        (field) =>
          field.differente ??
          (field.importato != null && field.attuale !== field.importato),
      )
    : fields.filter((field) => field.importato != null);
  if (!visible.length) return null;
  return (
    <table className="w-full table-fixed text-xs sm:text-sm">
      <thead>
        <tr className="border-b text-left">
          <th className="w-1/3 p-2" scope="col">
            {t("blocco07.comparisonField")}
          </th>
          {registered && (
            <th className="p-2" scope="col">
              {t("blocco07.registeredData")}
            </th>
          )}
          <th className="p-2" scope="col">
            {t("blocco07.importedData")}
          </th>
        </tr>
      </thead>
      <tbody>
        {visible.map((field) => (
          <tr key={field.campo} className="border-b last:border-0">
            <th scope="row" className="break-words p-2 text-left font-medium">
              {t(`blocco07.comparisonFields.${field.campo}`)}
            </th>
            {registered && (
              <td className="break-words p-2 align-top">
                {value(field, false)}
              </td>
            )}
            <td className="break-words p-2 align-top">
              <span
                className={
                  registered && field.attuale !== field.importato
                    ? "font-medium"
                    : undefined
                }
              >
                {value(field, true)}
              </span>
              {registered && (
                <span className="mt-1 block text-xs text-muted-foreground">
                  {t(`blocco07.comparisonEffect.${field.esito}`)}
                </span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
