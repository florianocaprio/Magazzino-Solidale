import type {
  InterventoAttivitaInput,
  InterventoDocumentoInput,
  InterventoDocumentoStato,
  InterventoMaterialeInput,
  InterventoMaterialeStato,
  Magazzino,
  Prodotto,
} from "@workspace/api-client-react";
import { Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

interface TipoOption {
  id: number;
  nome: string;
  attivo: boolean;
}

interface Props {
  attivita: InterventoAttivitaInput[];
  materiali: InterventoMaterialeInput[];
  documenti: InterventoDocumentoInput[];
  tipi: TipoOption[];
  prodotti: Prodotto[];
  magazzini: Magazzino[];
  readOnly?: boolean;
  showActivities?: boolean;
  onAttivitaChange: (value: InterventoAttivitaInput[]) => void;
  onMaterialiChange: (value: InterventoMaterialeInput[]) => void;
  onDocumentiChange: (value: InterventoDocumentoInput[]) => void;
}

const MATERIAL_STATUSES: InterventoMaterialeStato[] = [
  "da_preparare",
  "pronto",
  "consegnato",
  "annullato",
];
const DOCUMENT_STATUSES: InterventoDocumentoStato[] = [
  "da_acquisire",
  "da_verificare",
  "acquisito",
  "verificato",
  "non_disponibile",
  "annullato",
];

function replaceAt<T>(values: T[], index: number, value: T): T[] {
  return values.map((candidate, candidateIndex) =>
    candidateIndex === index ? value : candidate,
  );
}

export function InterventoSocialeOperativitaEditor({
  attivita,
  materiali,
  documenti,
  tipi,
  prodotti,
  magazzini,
  readOnly = false,
  showActivities = true,
  onAttivitaChange,
  onMaterialiChange,
  onDocumentiChange,
}: Props) {
  const { t } = useTranslation();
  return (
    <div className="space-y-6">
      {showActivities && (
        <section className="space-y-3" aria-labelledby="attivita-title">
          <div className="flex items-center justify-between gap-3">
            <h3 id="attivita-title" className="font-semibold">
              {t("interventi.operational.activities")}
            </h3>
            {!readOnly && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() =>
                  onAttivitaChange([
                    ...attivita,
                    {
                      tipologiaId: null,
                      tipologiaSnapshot: "",
                      descrizione: "",
                      risultato: "",
                    },
                  ])
                }
              >
                <Plus className="mr-2 h-4 w-4" />
                {t("interventi.operational.addActivity")}
              </Button>
            )}
          </div>
          {attivita.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("interventi.operational.noActivities")}
            </p>
          ) : (
            attivita.map((item, index) => (
              <div key={index} className="space-y-3 rounded-lg border p-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Select
                    value={
                      item.tipologiaId ? String(item.tipologiaId) : "custom"
                    }
                    disabled={readOnly}
                    onValueChange={(value) => {
                      const selected = tipi.find(
                        (tipo) => String(tipo.id) === value,
                      );
                      onAttivitaChange(
                        replaceAt(attivita, index, {
                          ...item,
                          tipologiaId: selected?.id ?? null,
                          tipologiaSnapshot:
                            selected?.nome ?? item.tipologiaSnapshot ?? "",
                        }),
                      );
                    }}
                  >
                    <SelectTrigger
                      aria-label={t("interventi.operational.activityType")}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="custom">
                        {t("interventi.operational.customActivity")}
                      </SelectItem>
                      {tipi.map((tipo) => (
                        <SelectItem key={tipo.id} value={String(tipo.id)}>
                          {tipo.nome}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {!item.tipologiaId && (
                    <Input
                      value={item.tipologiaSnapshot ?? ""}
                      readOnly={readOnly}
                      placeholder={t("interventi.operational.activityType")}
                      onChange={(event) =>
                        onAttivitaChange(
                          replaceAt(attivita, index, {
                            ...item,
                            tipologiaSnapshot: event.target.value,
                          }),
                        )
                      }
                    />
                  )}
                </div>
                <Textarea
                  value={item.descrizione}
                  readOnly={readOnly}
                  placeholder={t("interventi.operational.activityDescription")}
                  onChange={(event) =>
                    onAttivitaChange(
                      replaceAt(attivita, index, {
                        ...item,
                        descrizione: event.target.value,
                      }),
                    )
                  }
                />
                <Textarea
                  value={item.risultato ?? ""}
                  readOnly={readOnly}
                  placeholder={t("interventi.operational.specificResult")}
                  onChange={(event) =>
                    onAttivitaChange(
                      replaceAt(attivita, index, {
                        ...item,
                        risultato: event.target.value,
                      }),
                    )
                  }
                />
                {!readOnly && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      onAttivitaChange(
                        attivita.filter(
                          (_, candidateIndex) => candidateIndex !== index,
                        ),
                      )
                    }
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    {t("common.delete")}
                  </Button>
                )}
              </div>
            ))
          )}
        </section>
      )}

      <section className="space-y-3" aria-labelledby="materiali-title">
        <div className="flex items-center justify-between gap-3">
          <h3 id="materiali-title" className="font-semibold">
            {t("interventi.operational.materials")}
          </h3>
          {!readOnly && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() =>
                onMaterialiChange([
                  ...materiali,
                  {
                    prodottoId: null,
                    descrizioneSnapshot: "",
                    unitaMisuraSnapshot: "pz",
                    quantitaPrevista: 0,
                    quantitaConsegnata: 0,
                    statoPreparazione: "da_preparare",
                    magazzinoId: null,
                    note: "",
                  },
                ])
              }
            >
              <Plus className="mr-2 h-4 w-4" />
              {t("interventi.operational.addMaterial")}
            </Button>
          )}
        </div>
        {materiali.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("interventi.operational.noMaterials")}
          </p>
        ) : (
          materiali.map((item, index) => (
            <div key={index} className="space-y-3 rounded-lg border p-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Select
                  value={item.prodottoId ? String(item.prodottoId) : "generic"}
                  disabled={readOnly}
                  onValueChange={(value) => {
                    const product = prodotti.find(
                      (candidate) => String(candidate.id) === value,
                    );
                    onMaterialiChange(
                      replaceAt(materiali, index, {
                        ...item,
                        prodottoId: product?.id ?? null,
                        descrizioneSnapshot:
                          product?.nome ?? item.descrizioneSnapshot ?? "",
                        unitaMisuraSnapshot:
                          product?.unitaMisura ??
                          item.unitaMisuraSnapshot ??
                          "pz",
                      }),
                    );
                  }}
                >
                  <SelectTrigger
                    aria-label={t("interventi.operational.catalogProduct")}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="generic">
                      {t("interventi.operational.genericMaterial")}
                    </SelectItem>
                    {prodotti
                      .filter((product) => product.attivo)
                      .map((product) => (
                        <SelectItem key={product.id} value={String(product.id)}>
                          {product.nome} · {product.unitaMisura}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                <Select
                  value={item.magazzinoId ? String(item.magazzinoId) : "none"}
                  disabled={readOnly}
                  onValueChange={(value) =>
                    onMaterialiChange(
                      replaceAt(materiali, index, {
                        ...item,
                        magazzinoId: value === "none" ? null : Number(value),
                      }),
                    )
                  }
                >
                  <SelectTrigger
                    aria-label={t("interventi.operational.warehouse")}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">–</SelectItem>
                    {magazzini.map((magazzino) => (
                      <SelectItem
                        key={magazzino.id}
                        value={String(magazzino.id)}
                      >
                        {magazzino.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {!item.prodottoId && (
                <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
                  <Input
                    value={item.descrizioneSnapshot ?? ""}
                    readOnly={readOnly}
                    placeholder={t(
                      "interventi.operational.materialDescription",
                    )}
                    onChange={(event) =>
                      onMaterialiChange(
                        replaceAt(materiali, index, {
                          ...item,
                          descrizioneSnapshot: event.target.value,
                        }),
                      )
                    }
                  />
                  <Input
                    value={item.unitaMisuraSnapshot ?? ""}
                    readOnly={readOnly}
                    placeholder={t("interventi.operational.unit")}
                    onChange={(event) =>
                      onMaterialiChange(
                        replaceAt(materiali, index, {
                          ...item,
                          unitaMisuraSnapshot: event.target.value,
                        }),
                      )
                    }
                  />
                </div>
              )}
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="space-y-1 text-sm">
                  <span>{t("interventi.operational.plannedQuantity")}</span>
                  <Input
                    type="number"
                    min="0"
                    step="0.001"
                    readOnly={readOnly}
                    value={item.quantitaPrevista ?? 0}
                    onChange={(event) =>
                      onMaterialiChange(
                        replaceAt(materiali, index, {
                          ...item,
                          quantitaPrevista: Number(event.target.value),
                        }),
                      )
                    }
                  />
                </label>
                <label className="space-y-1 text-sm">
                  <span>{t("interventi.operational.deliveredQuantity")}</span>
                  <Input
                    type="number"
                    min="0"
                    step="0.001"
                    readOnly={readOnly}
                    value={item.quantitaConsegnata ?? 0}
                    onChange={(event) =>
                      onMaterialiChange(
                        replaceAt(materiali, index, {
                          ...item,
                          quantitaConsegnata: Number(event.target.value),
                        }),
                      )
                    }
                  />
                </label>
                <Select
                  value={item.statoPreparazione ?? "da_preparare"}
                  disabled={readOnly}
                  onValueChange={(value) =>
                    onMaterialiChange(
                      replaceAt(materiali, index, {
                        ...item,
                        statoPreparazione: value as InterventoMaterialeStato,
                      }),
                    )
                  }
                >
                  <SelectTrigger
                    aria-label={t("interventi.operational.preparationState")}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MATERIAL_STATUSES.map((status) => (
                      <SelectItem key={status} value={status}>
                        {t(`interventi.operational.materialStates.${status}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Input
                value={item.note ?? ""}
                readOnly={readOnly}
                placeholder={t("interventi.note")}
                onChange={(event) =>
                  onMaterialiChange(
                    replaceAt(materiali, index, {
                      ...item,
                      note: event.target.value,
                    }),
                  )
                }
              />
              {!readOnly && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    onMaterialiChange(
                      materiali.filter(
                        (_, candidateIndex) => candidateIndex !== index,
                      ),
                    )
                  }
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  {t("common.delete")}
                </Button>
              )}
            </div>
          ))
        )}
      </section>

      <section className="space-y-3" aria-labelledby="documenti-title">
        <div className="flex items-center justify-between gap-3">
          <h3 id="documenti-title" className="font-semibold">
            {t("interventi.operational.documents")}
          </h3>
          {!readOnly && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() =>
                onDocumentiChange([
                  ...documenti,
                  {
                    tipoDescrizione: "",
                    stato: "da_acquisire",
                    dataScadenza: null,
                    note: "",
                  },
                ])
              }
            >
              <Plus className="mr-2 h-4 w-4" />
              {t("interventi.operational.addDocument")}
            </Button>
          )}
        </div>
        {documenti.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("interventi.operational.noDocuments")}
          </p>
        ) : (
          documenti.map((item, index) => (
            <div
              key={index}
              className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2"
            >
              <Input
                value={item.tipoDescrizione}
                readOnly={readOnly}
                placeholder={t("interventi.operational.documentType")}
                onChange={(event) =>
                  onDocumentiChange(
                    replaceAt(documenti, index, {
                      ...item,
                      tipoDescrizione: event.target.value,
                    }),
                  )
                }
              />
              <Select
                value={item.stato}
                disabled={readOnly}
                onValueChange={(value) =>
                  onDocumentiChange(
                    replaceAt(documenti, index, {
                      ...item,
                      stato: value as InterventoDocumentoStato,
                    }),
                  )
                }
              >
                <SelectTrigger
                  aria-label={t("interventi.operational.documentState")}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DOCUMENT_STATUSES.map((status) => (
                    <SelectItem key={status} value={status}>
                      {t(`interventi.operational.documentStates.${status}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                type="date"
                value={item.dataScadenza ?? ""}
                readOnly={readOnly}
                aria-label={t("interventi.operational.expiry")}
                onChange={(event) =>
                  onDocumentiChange(
                    replaceAt(documenti, index, {
                      ...item,
                      dataScadenza: event.target.value || null,
                    }),
                  )
                }
              />
              <Input
                value={item.note ?? ""}
                readOnly={readOnly}
                placeholder={t("interventi.note")}
                onChange={(event) =>
                  onDocumentiChange(
                    replaceAt(documenti, index, {
                      ...item,
                      note: event.target.value,
                    }),
                  )
                }
              />
              {!readOnly && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    onDocumentiChange(
                      documenti.filter(
                        (_, candidateIndex) => candidateIndex !== index,
                      ),
                    )
                  }
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  {t("common.delete")}
                </Button>
              )}
            </div>
          ))
        )}
      </section>
    </div>
  );
}
