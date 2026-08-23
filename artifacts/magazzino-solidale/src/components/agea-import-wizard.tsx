import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  analyzeAgeaImportazioneBinary,
  getListAgeaImportazioneDescrizioniDaMappareQueryKey,
  getListAgeaImportazionePartiteQueryKey,
  getListAgeaImportazioniQueryKey,
  listAgeaImportazioneRigheFiltered,
  useConfirmAgeaImportazione,
  useCancelAgeaImportazione,
  useCreateAgeaMappaturaProdotto,
  useListAgeaImportazionePartite,
  useListAgeaImportazioneDescrizioniDaMappare,
  useListAgeaImportazioni,
  useListAgeaMappatureProdotti,
  useListMagazzini,
  useListProdotti,
  useRecalculateAgeaImportazione,
  useUpdateAgeaImportazioneRigaDataCarico,
  useUpdateAgeaImportazioneRigaLotto,
  useUpdateAgeaImportazionePartita,
  useUpdateAgeaMappaturaProdotto,
  type AgeaImportModalita,
  type AgeaImportazione,
} from "@workspace/api-client-react";
import {
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
  RefreshCw,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";

const modes: Array<{ value: AgeaImportModalita; label: string }> = [
  { value: "PRIMA_ACQUISIZIONE", label: "Prima acquisizione" },
  { value: "AGGIORNAMENTO", label: "Aggiornamento" },
  { value: "SOLO_ANALISI", label: "Solo analisi" },
];

function errorMessage(error: unknown): string {
  return (
    (error as { data?: { error?: string }; message?: string })?.data?.error ??
    (error as { message?: string })?.message ??
    "Operazione non riuscita"
  );
}

function StepTitle({ number, children }: { number: number; children: string }) {
  return (
    <div className="flex items-center gap-2 font-semibold">
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground">
        {number}
      </span>
      {children}
    </div>
  );
}

export function AgeaImportWizard() {
  const { hasPermission } = useAuth();
  const canImport = hasPermission("magazzino.agea.import");
  const canManageMapping = hasPermission("magazzino.agea.mapping.manage");
  const canCreateProduct = hasPermission("magazzino.products.manage");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: magazzini } = useListMagazzini();
  const { data: prodotti } = useListProdotti();
  const importsQuery = useListAgeaImportazioni();
  const mappingsQuery = useListAgeaMappatureProdotti();
  const [magazzinoId, setMagazzinoId] = useState("");
  const [mode, setMode] = useState<AgeaImportModalita>("PRIMA_ACQUISIZIONE");
  const [file, setFile] = useState<File | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [rowPage, setRowPage] = useState(1);
  const [rowPageSize, setRowPageSize] = useState(25);
  const [rowState, setRowState] = useState("all");
  const [rowType, setRowType] = useState("all");
  const [rowFund, setRowFund] = useState("all");
  const [rowSearch, setRowSearch] = useState("");
  const [correctionDrafts, setCorrectionDrafts] = useState<
    Record<number, { date?: string; lot?: string; motivation?: string }>
  >({});
  const [expiryMotivation, setExpiryMotivation] = useState("");
  const [productByDescription, setProductByDescription] = useState<
    Record<string, string>
  >({});
  const [previewDirtyByImport, setPreviewDirtyByImport] = useState<
    Record<number, boolean>
  >({});
  const analyze = useMutation({
    mutationFn: () => {
      if (!file || !magazzinoId)
        throw new Error("Seleziona magazzino e file XLSX");
      return analyzeAgeaImportazioneBinary(file, {
        magazzinoId: Number(magazzinoId),
        modalita: mode,
        nomeFile: file.name,
      });
    },
    onSuccess: (result) => {
      setSelectedId(result.id);
      setPreviewDirtyByImport((current) => ({
        ...current,
        [result.id]: false,
      }));
      queryClient.invalidateQueries({
        queryKey: getListAgeaImportazioniQueryKey(),
      });
      toast({
        title: "Registro analizzato",
        description: `${result.righeTotali} righe conservate nello staging.`,
      });
    },
    onError: (error) =>
      toast({
        title: "Analisi non riuscita",
        description: errorMessage(error),
        variant: "destructive",
      }),
  });
  const selected = useMemo(
    () => importsQuery.data?.find((item) => item.id === selectedId) ?? null,
    [importsQuery.data, selectedId],
  );
  const previewDirty =
    selectedId != null && previewDirtyByImport[selectedId] === true;
  const markSelectedPreviewDirty = () => {
    if (selectedId == null) return;
    setPreviewDirtyByImport((current) => ({
      ...current,
      [selectedId]: true,
    }));
  };
  const partiesQuery = useListAgeaImportazionePartite(selectedId ?? 0, {
    query: {
      enabled: selectedId != null,
      queryKey: getListAgeaImportazionePartiteQueryKey(selectedId ?? 0),
    },
  });
  const rowsQuery = useQuery({
    queryKey: [
      "agea-import-rows",
      selectedId,
      rowPage,
      rowPageSize,
      rowState,
      rowType,
      rowFund,
      rowSearch,
    ],
    queryFn: () =>
      listAgeaImportazioneRigheFiltered(selectedId!, {
        page: rowPage,
        pageSize: rowPageSize,
        stato: rowState === "all" ? undefined : rowState,
        tipo: rowType === "all" ? undefined : rowType,
        fondo: rowFund === "all" ? undefined : rowFund,
        q: rowSearch || undefined,
      }),
    enabled: selectedId != null,
  });
  const descriptionsQuery = useListAgeaImportazioneDescrizioniDaMappare(
    selectedId ?? 0,
    {
      query: {
        enabled: selectedId != null,
        queryKey: getListAgeaImportazioneDescrizioniDaMappareQueryKey(
          selectedId ?? 0,
        ),
      },
    },
  );
  const createMapping = useCreateAgeaMappaturaProdotto();
  const updateMapping = useUpdateAgeaMappaturaProdotto();
  const recalculate = useRecalculateAgeaImportazione();
  const updateParty = useUpdateAgeaImportazionePartita();
  const updateLoadDate = useUpdateAgeaImportazioneRigaDataCarico();
  const updateLot = useUpdateAgeaImportazioneRigaLotto();
  const confirm = useConfirmAgeaImportazione();
  const cancel = useCancelAgeaImportazione();

  const refreshImport = async (next?: AgeaImportazione) => {
    if (next) setSelectedId(next.id);
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: getListAgeaImportazioniQueryKey(),
      }),
      queryClient.invalidateQueries({
        queryKey: ["agea-import-rows", selectedId],
      }),
      queryClient.invalidateQueries({
        queryKey: ["/api/agea/mappature-prodotti"],
      }),
      selectedId
        ? queryClient.invalidateQueries({
            queryKey:
              getListAgeaImportazioneDescrizioniDaMappareQueryKey(selectedId),
          })
        : Promise.resolve(),
      selectedId
        ? queryClient.invalidateQueries({
            queryKey: getListAgeaImportazionePartiteQueryKey(selectedId),
          })
        : Promise.resolve(),
    ]);
  };

  const mapDescription = (
    description: string,
    raw: string,
    currentProductId?: number | null,
    currentMapping?: {
      id: number;
      version: number;
      active: boolean;
    } | null,
  ) => {
    const productId = Number(
      productByDescription[description] ?? currentProductId,
    );
    if (!productId) return;
    if (currentMapping) {
      updateMapping.mutate(
        {
          id: currentMapping.id,
          data: {
            prodottoId: productId,
            attiva: currentMapping.active,
            versione: currentMapping.version,
          },
        },
        {
          onSuccess: () => {
            markSelectedPreviewDirty();
            void refreshImport();
            toast({ title: "Mapping aggiornato", description: raw });
          },
          onError: (error) =>
            toast({
              title: "Mapping non aggiornato",
              description: errorMessage(error),
              variant: "destructive",
            }),
        },
      );
      return;
    }
    createMapping.mutate(
      { data: { descrizioneEsterna: raw, prodottoId: productId } },
      {
        onSuccess: () => {
          markSelectedPreviewDirty();
          queryClient.invalidateQueries({
            queryKey: ["/api/agea/mappature-prodotti"],
          });
          void refreshImport();
          toast({ title: "Mapping salvato", description: raw });
        },
        onError: (error) =>
          toast({
            title: "Mapping non salvato",
            description: errorMessage(error),
            variant: "destructive",
          }),
      },
    );
  };

  const saveRowCorrection = (rowId: number, field: "date" | "lot") => {
    if (!selected) return;
    const draft = correctionDrafts[rowId] ?? {};
    const motivation = draft.motivation?.trim();
    if (!motivation) {
      toast({
        title: "Motivazione richiesta",
        description: "Indica il motivo della correzione manuale.",
        variant: "destructive",
      });
      return;
    }
    const mutation = field === "date" ? updateLoadDate : updateLot;
    mutation.mutate(
      {
        id: selected.id,
        rigaId: rowId,
        data: {
          valore: field === "date" ? draft.date || null : draft.lot || null,
          motivazione: motivation,
          versione: selected.versione,
        },
      },
      {
        onSuccess: (result) => void refreshImport(result),
        onError: (error) =>
          toast({
            title: "Correzione non salvata",
            description: errorMessage(error),
            variant: "destructive",
          }),
      },
    );
  };

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
        <strong>Import locale:</strong> questa funzione legge il registro nel
        sistema e non trasmette dati a SIFEAD.
      </div>

      <Card>
        <CardHeader>
          <StepTitle number={1}>Magazzino, modalità e file XLSX</StepTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label>Magazzino</Label>
            <Select value={magazzinoId} onValueChange={setMagazzinoId}>
              <SelectTrigger>
                <SelectValue placeholder="Seleziona" />
              </SelectTrigger>
              <SelectContent>
                {magazzini
                  ?.filter((item) => item.stato === "attivo")
                  .map((item) => (
                    <SelectItem key={item.id} value={String(item.id)}>
                      {item.nome}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Modalità</Label>
            <Select
              value={mode}
              onValueChange={(value) => setMode(value as AgeaImportModalita)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {modes.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="agea-file">Registro .xlsx (max 10 MB)</Label>
            <Input
              id="agea-file"
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </div>
          {mode === "PRIMA_ACQUISIZIONE" && (
            <div className="md:col-span-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <AlertTriangle className="mr-2 inline h-4 w-4" />
              La prima acquisizione crea il saldo ufficiale alla data del
              registro. Non ricostruisce tutti i carichi storici.
            </div>
          )}
          <div className="md:col-span-3">
            <Button
              onClick={() => analyze.mutate()}
              disabled={
                !file || !magazzinoId || analyze.isPending || !canImport
              }
            >
              <FileSpreadsheet className="mr-2 h-4 w-4" />
              {analyze.isPending ? "Analisi…" : "Analizza registro"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <StepTitle number={2}>Analisi del tracciato</StepTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Select
            value={selectedId ? String(selectedId) : "none"}
            onValueChange={(value) =>
              setSelectedId(value === "none" ? null : Number(value))
            }
          >
            <SelectTrigger className="max-w-xl">
              <SelectValue placeholder="Seleziona un'analisi" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Nessuna analisi selezionata</SelectItem>
              {importsQuery.data?.map((item) => (
                <SelectItem key={item.id} value={String(item.id)}>
                  #{item.id} · {item.nomeFile} · {item.stato}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selected && (
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6 text-sm">
              <div>
                <span className="text-muted-foreground">Data</span>
                <div>{selected.dataRiferimento}</div>
              </div>
              <div>
                <span className="text-muted-foreground">Foglio</span>
                <div>{selected.sheetName}</div>
              </div>
              <div>
                <span className="text-muted-foreground">Righe</span>
                <div>{selected.righeTotali}</div>
              </div>
              <div>
                <span className="text-muted-foreground">Carichi</span>
                <div>{selected.righeCarico}</div>
              </div>
              <div>
                <span className="text-muted-foreground">Distribuzioni</span>
                <div>{selected.righeDistribuzione}</div>
              </div>
              <div>
                <span className="text-muted-foreground">Resi</span>
                <div>{selected.righeReso}</div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <StepTitle number={3}>Mappatura prodotti</StepTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {mappingsQuery.data?.length ?? 0} mapping globali confermati.
            Nessuna associazione viene creata automaticamente.
          </p>
          {descriptionsQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">
              Caricamento descrizioni…
            </p>
          ) : descriptionsQuery.isError ? (
            <p className="text-sm text-destructive">
              Impossibile caricare le descrizioni dell'importazione.
            </p>
          ) : (descriptionsQuery.data?.length ?? 0) === 0 ? (
            <div className="flex items-center gap-2 text-sm text-green-700">
              <CheckCircle2 className="h-4 w-4" />
              Nessuna descrizione presente.
            </div>
          ) : (
            descriptionsQuery.data?.map((description) => (
              <div
                key={description.chiaveDescrizioneNormalizzata}
                className="grid gap-2 rounded-md border p-3 md:grid-cols-[1fr_1fr_auto] md:items-center"
              >
                <div>
                  <div className="font-medium">
                    {description.descrizioneRawRappresentativa}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {description.chiaveDescrizioneNormalizzata} ·{" "}
                    {description.numeroRighe} righe ·{" "}
                    {description.fondi.join(", ")}
                  </div>
                  <div className="text-xs">
                    {description.mappingId
                      ? `${description.prodottoNome ?? "Prodotto"} · ${description.mappingAttiva ? "attivo" : "disabilitato"}`
                      : "Non associato"}
                  </div>
                </div>
                <Select
                  value={
                    productByDescription[
                      description.chiaveDescrizioneNormalizzata
                    ] ?? String(description.prodottoId ?? "")
                  }
                  onValueChange={(value) =>
                    setProductByDescription((current) => ({
                      ...current,
                      [description.chiaveDescrizioneNormalizzata]: value,
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Prodotto interno" />
                  </SelectTrigger>
                  <SelectContent>
                    {prodotti
                      ?.filter((item) => item.attivo)
                      .map((item) => (
                        <SelectItem key={item.id} value={String(item.id)}>
                          {item.nome} · {item.unitaMisura}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    disabled={
                      !(
                        productByDescription[
                          description.chiaveDescrizioneNormalizzata
                        ] ?? description.prodottoId
                      ) ||
                      createMapping.isPending ||
                      !canManageMapping
                    }
                    onClick={() =>
                      mapDescription(
                        description.chiaveDescrizioneNormalizzata,
                        description.descrizioneRawRappresentativa,
                        description.prodottoId,
                        description.mappingId && description.mappingVersione
                          ? {
                              id: description.mappingId,
                              version: description.mappingVersione,
                              active: description.mappingAttiva ?? true,
                            }
                          : null,
                      )
                    }
                  >
                    {description.mappingId ? "Aggiorna" : "Associa"}
                  </Button>
                  {description.mappingId &&
                    description.mappingVersione &&
                    description.prodottoId && (
                      <Button
                        variant="ghost"
                        disabled={updateMapping.isPending || !canManageMapping}
                        onClick={() =>
                          updateMapping.mutate(
                            {
                              id: description.mappingId!,
                              data: {
                                prodottoId: description.prodottoId!,
                                attiva: !description.mappingAttiva,
                                versione: description.mappingVersione!,
                              },
                            },
                            {
                              onSuccess: () => {
                                markSelectedPreviewDirty();
                                void refreshImport();
                              },
                              onError: (error) =>
                                toast({
                                  title: "Mapping non aggiornato",
                                  description: errorMessage(error),
                                  variant: "destructive",
                                }),
                            },
                          )
                        }
                      >
                        {description.mappingAttiva ? "Disabilita" : "Riabilita"}
                      </Button>
                    )}
                </div>
              </div>
            ))
          )}
          {canCreateProduct && (
            <Button variant="link" asChild className="px-0">
              <a href="/prodotti">Crea un prodotto nel flusso Prodotti</a>
            </Button>
          )}
          {selected && (
            <Button
              variant="secondary"
              disabled={!canImport || recalculate.isPending}
              onClick={() =>
                recalculate.mutate(
                  { id: selected.id, data: { versione: selected.versione } },
                  {
                    onSuccess: (result) => {
                      setPreviewDirtyByImport((current) => ({
                        ...current,
                        [result.id]: false,
                      }));
                      void refreshImport(result);
                    },
                    onError: (error) =>
                      toast({
                        title: "Preflight non ricalcolato",
                        description: errorMessage(error),
                        variant: "destructive",
                      }),
                  },
                )
              }
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Ricalcola preflight
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <StepTitle number={4}>Partite preview</StepTitle>
        </CardHeader>
        <CardContent className="space-y-3 p-0 overflow-x-auto">
          <div className="px-4">
            <Label htmlFor="agea-expiry-motivation">
              Motivazione correzione scadenza
            </Label>
            <Input
              id="agea-expiry-motivation"
              value={expiryMotivation}
              onChange={(event) => setExpiryMotivation(event.target.value)}
              placeholder="Motivo obbligatorio per salvare o rimuovere"
            />
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fondo</TableHead>
                <TableHead>Prodotto</TableHead>
                <TableHead>Lotto</TableHead>
                <TableHead>Saldo Pz</TableHead>
                <TableHead>Saldo Kg/Lt</TableHead>
                <TableHead>Fattore</TableHead>
                <TableHead>Scadenza</TableHead>
                <TableHead>Stato</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {partiesQuery.data?.map((party) => (
                <TableRow key={party.id}>
                  <TableCell>{party.fondoOrigine}</TableCell>
                  <TableCell>{party.prodottoNormalizzato}</TableCell>
                  <TableCell>{party.lottoRaw ?? "—"}</TableCell>
                  <TableCell>{party.saldoFinalePezzi ?? "—"}</TableCell>
                  <TableCell>{party.saldoFinaleKgLt ?? "—"}</TableCell>
                  <TableCell>{party.fattoreKgLtPezzo ?? "—"}</TableCell>
                  <TableCell>
                    {party.existingLottoId ? (
                      (party.dataScadenzaRisolta ?? "—")
                    ) : (
                      <Input
                        type="date"
                        className="min-w-36"
                        disabled={!canImport}
                        defaultValue={party.dataScadenzaRisolta ?? ""}
                        onBlur={(event) =>
                          selectedId &&
                          selected &&
                          expiryMotivation.trim() &&
                          updateParty.mutate(
                            {
                              id: selectedId,
                              partitaId: party.id,
                              data: {
                                dataScadenza: event.target.value || null,
                                motivazione: expiryMotivation.trim(),
                                versione: selected.versione,
                              },
                            },
                            {
                              onSuccess: (result) => void refreshImport(result),
                              onError: (error) =>
                                toast({
                                  title: "Scadenza non salvata",
                                  description: errorMessage(error),
                                  variant: "destructive",
                                }),
                            },
                          )
                        }
                      />
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={party.blocking ? "destructive" : "outline"}>
                      {party.stato}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <StepTitle number={5}>Righe preview</StepTitle>
        </CardHeader>
        <CardContent className="space-y-3 p-0 overflow-x-auto">
          <div className="grid gap-2 px-4 md:grid-cols-5">
            <Input
              value={rowSearch}
              onChange={(event) => {
                setRowSearch(event.target.value);
                setRowPage(1);
              }}
              placeholder="Cerca prodotto, lotto, documento"
            />
            <Select
              value={rowState}
              onValueChange={(value) => {
                setRowState(value);
                setRowPage(1);
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Stato" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tutti gli stati</SelectItem>
                <SelectItem value="DA_MAPPARE">Da mappare</SelectItem>
                <SelectItem value="BLOCCATA">Bloccata</SelectItem>
                <SelectItem value="DA_APPLICARE">Da applicare</SelectItem>
                <SelectItem value="DUPLICATA">Duplicata</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={rowType}
              onValueChange={(value) => {
                setRowType(value);
                setRowPage(1);
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Tipo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tutti i tipi</SelectItem>
                <SelectItem value="CARICO">Carico</SelectItem>
                <SelectItem value="DISTRIBUZIONE">Distribuzione</SelectItem>
                <SelectItem value="RESO">Reso</SelectItem>
                <SelectItem value="MOVIMENTO_NEGATIVO_NON_CLASSIFICATO">
                  Negativo non classificato
                </SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={rowFund}
              onValueChange={(value) => {
                setRowFund(value);
                setRowPage(1);
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Fondo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tutti i fondi</SelectItem>
                <SelectItem value="FSE_PLUS">FSE+</SelectItem>
                <SelectItem value="FONDO_NAZIONALE">Fondo nazionale</SelectItem>
                <SelectItem value="FONDO_NAZIONALE_COFINANZIATO">
                  Fondo nazionale cofinanziato
                </SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={String(rowPageSize)}
              onValueChange={(value) => {
                setRowPageSize(Number(value));
                setRowPage(1);
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[10, 25, 50, 100].map((size) => (
                  <SelectItem key={size} value={String(size)}>
                    {size} per pagina
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {rowsQuery.isLoading && (
            <p className="px-4 text-sm text-muted-foreground">
              Caricamento preview…
            </p>
          )}
          {rowsQuery.isError && (
            <p className="px-4 text-sm text-destructive">
              Preview non disponibile.
            </p>
          )}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Riga</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Prodotto</TableHead>
                <TableHead>Data carico raw / effettiva</TableHead>
                <TableHead>Lotto raw / effettivo</TableHead>
                <TableHead>Documento</TableHead>
                <TableHead>Stato</TableHead>
                <TableHead>Errori / avvisi</TableHead>
                <TableHead>Correzioni manuali</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rowsQuery.data?.items.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>{row.numeroRiga}</TableCell>
                  <TableCell>{row.tipoMovimentoEsterno}</TableCell>
                  <TableCell>{row.prodottoRaw}</TableCell>
                  <TableCell>
                    <div>{row.dataCaricoMagazzinoRaw ?? "—"}</div>
                    <div className="text-xs text-muted-foreground">
                      {row.dataCaricoEffettiva ?? row.dataCaricoRisolta ?? "—"}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div>{row.lottoRaw ?? "—"}</div>
                    <div className="text-xs text-muted-foreground">
                      {row.lottoEffettivoRaw ?? row.lottoRaw ?? "—"}
                    </div>
                  </TableCell>
                  <TableCell>{row.numeroDocumentoRaw ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant={row.blocking ? "destructive" : "secondary"}>
                      {row.statoRiga}
                    </Badge>
                  </TableCell>
                  <TableCell className="min-w-52 text-xs">
                    {row.errorCodesJson.length > 0 && (
                      <div className="text-destructive">
                        {row.errorCodesJson.join(", ")}
                      </div>
                    )}
                    {row.warningCodesJson.length > 0 && (
                      <div className="text-amber-700">
                        {row.warningCodesJson.join(", ")}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="min-w-72 space-y-2">
                    <Input
                      type="date"
                      value={correctionDrafts[row.id]?.date ?? ""}
                      onChange={(event) =>
                        setCorrectionDrafts((current) => ({
                          ...current,
                          [row.id]: {
                            ...current[row.id],
                            date: event.target.value,
                          },
                        }))
                      }
                    />
                    <Input
                      value={correctionDrafts[row.id]?.lot ?? ""}
                      maxLength={80}
                      onChange={(event) =>
                        setCorrectionDrafts((current) => ({
                          ...current,
                          [row.id]: {
                            ...current[row.id],
                            lot: event.target.value,
                          },
                        }))
                      }
                      placeholder="Lotto effettivo (vuoto = rimuovi)"
                    />
                    <Input
                      value={correctionDrafts[row.id]?.motivation ?? ""}
                      onChange={(event) =>
                        setCorrectionDrafts((current) => ({
                          ...current,
                          [row.id]: {
                            ...current[row.id],
                            motivation: event.target.value,
                          },
                        }))
                      }
                      placeholder="Motivazione obbligatoria"
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!canImport}
                        onClick={() => saveRowCorrection(row.id, "date")}
                      >
                        Salva data
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!canImport}
                        onClick={() => saveRowCorrection(row.id, "lot")}
                      >
                        Salva lotto
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex items-center justify-between border-t p-3 text-xs text-muted-foreground">
            <span>
              Pagina {rowPage} · {rowsQuery.data?.items.length ?? 0} di{" "}
              {rowsQuery.data?.total ?? 0} righe filtrate
            </span>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={rowPage <= 1 || rowsQuery.isFetching}
                onClick={() => setRowPage((page) => page - 1)}
              >
                Precedente
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={
                  rowsQuery.isFetching ||
                  rowPage * rowPageSize >= (rowsQuery.data?.total ?? 0)
                }
                onClick={() => setRowPage((page) => page + 1)}
              >
                Successiva
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <StepTitle number={6}>Preflight</StepTitle>
        </CardHeader>
        <CardContent>
          {selected ? (
            <div className="space-y-3 text-sm">
              {previewDirty && (
                <div className="rounded-md border border-amber-300 bg-amber-50 p-3 font-medium text-amber-900">
                  Preview da ricalcolare
                </div>
              )}
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <strong>{selected.partiteSaldoPositivo}</strong> Partite da
                  inizializzare
                </div>
                <div>
                  <strong>{selected.righeCarico}</strong> carichi
                  storici/positivi
                </div>
                <div>
                  <strong>
                    {selected.righeDistribuzione + selected.righeReso}
                  </strong>{" "}
                  movimenti negativi di riferimento
                </div>
                <div>
                  <strong>{selected.righeDuplicate}</strong> duplicati
                </div>
                <div>
                  <strong>{selected.righeModificate}</strong> conflitti
                </div>
                <div>
                  <Badge
                    variant={
                      selected.stato === "PRONTA" ? "default" : "destructive"
                    }
                  >
                    {selected.stato}
                  </Badge>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Analizza o seleziona un registro.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <StepTitle number={7}>Conferma esplicita</StepTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            La conferma è atomica. I movimenti negativi restano riferimento e
            non riducono lo stock nella 2.0B.
          </p>
          <Button
            disabled={
              !selected ||
              selected.stato !== "PRONTA" ||
              previewDirty ||
              confirm.isPending ||
              !canImport ||
              (selected.modalita === "PRIMA_ACQUISIZIONE" &&
                !hasPermission("magazzino.agea.bootstrap"))
            }
            onClick={() =>
              selected &&
              confirm.mutate(
                { id: selected.id, data: { versione: selected.versione } },
                {
                  onSuccess: (result) => {
                    void refreshImport(result.importazione);
                    toast({
                      title: result.replay
                        ? "Importazione già confermata"
                        : "Importazione confermata",
                      description: `${result.carichi.length} carichi locali creati.`,
                    });
                  },
                  onError: (error) =>
                    toast({
                      title: "Conferma non riuscita",
                      description: errorMessage(error),
                      variant: "destructive",
                    }),
                },
              )
            }
          >
            {confirm.isPending ? "Conferma…" : "Conferma importazione"}
          </Button>
          <Button
            variant="destructive"
            disabled={
              !selected ||
              ["CONFERMATA", "ANNULLATA"].includes(selected.stato) ||
              cancel.isPending ||
              !canImport
            }
            onClick={() => {
              if (
                !selected ||
                !window.confirm(
                  `Annullare l'importazione #${selected.id}? L'operazione rende la preview immutabile.`,
                )
              )
                return;
              cancel.mutate(
                { id: selected.id, data: { versione: selected.versione } },
                {
                  onSuccess: (result) => void refreshImport(result),
                  onError: (error) =>
                    toast({
                      title: "Annullamento non riuscito",
                      description: errorMessage(error),
                      variant: "destructive",
                    }),
                },
              );
            }}
          >
            {cancel.isPending ? "Annullamento…" : "Annulla importazione"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
