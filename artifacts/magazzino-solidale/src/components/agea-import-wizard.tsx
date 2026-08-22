import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  analyzeAgeaImportazioneBinary,
  getListAgeaImportazionePartiteQueryKey,
  getListAgeaImportazioniQueryKey,
  listAgeaImportazioneRigheFiltered,
  useConfirmAgeaImportazione,
  useCreateAgeaMappaturaProdotto,
  useListAgeaImportazionePartite,
  useListAgeaImportazioni,
  useListAgeaMappatureProdotti,
  useListMagazzini,
  useListProdotti,
  useRecalculateAgeaImportazione,
  useUpdateAgeaImportazionePartita,
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
  const [productByDescription, setProductByDescription] = useState<
    Record<string, string>
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
  const partiesQuery = useListAgeaImportazionePartite(selectedId ?? 0, {
    query: {
      enabled: selectedId != null,
      queryKey: getListAgeaImportazionePartiteQueryKey(selectedId ?? 0),
    },
  });
  const rowsQuery = useQuery({
    queryKey: ["agea-import-rows", selectedId, "preview"],
    queryFn: () =>
      listAgeaImportazioneRigheFiltered(selectedId!, { page: 1, pageSize: 50 }),
    enabled: selectedId != null,
  });
  const missingRowsQuery = useQuery({
    queryKey: ["agea-import-rows", selectedId, "missing"],
    queryFn: () =>
      listAgeaImportazioneRigheFiltered(selectedId!, {
        page: 1,
        pageSize: 200,
        stato: "DA_MAPPARE",
      }),
    enabled: selectedId != null,
  });
  const missingDescriptions = useMemo(
    () => [
      ...new Map(
        (missingRowsQuery.data?.items ?? []).map((row) => [
          row.prodottoNormalizzato,
          row.prodottoRaw,
        ]),
      ).entries(),
    ],
    [missingRowsQuery.data],
  );
  const createMapping = useCreateAgeaMappaturaProdotto();
  const recalculate = useRecalculateAgeaImportazione();
  const updateParty = useUpdateAgeaImportazionePartita();
  const confirm = useConfirmAgeaImportazione();

  const refreshImport = async (next?: AgeaImportazione) => {
    if (next) setSelectedId(next.id);
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: getListAgeaImportazioniQueryKey(),
      }),
      queryClient.invalidateQueries({
        queryKey: ["agea-import-rows", selectedId],
      }),
      selectedId
        ? queryClient.invalidateQueries({
            queryKey: getListAgeaImportazionePartiteQueryKey(selectedId),
          })
        : Promise.resolve(),
    ]);
  };

  const mapDescription = (description: string, raw: string) => {
    const productId = Number(productByDescription[description]);
    if (!productId) return;
    createMapping.mutate(
      { data: { descrizioneEsterna: raw, prodottoId: productId } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({
            queryKey: ["/api/agea/mappature-prodotti"],
          });
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
                !file ||
                !magazzinoId ||
                analyze.isPending ||
                !hasPermission("magazzino.agea.import")
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
          {missingDescriptions.length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-green-700">
              <CheckCircle2 className="h-4 w-4" />
              Nessuna descrizione visibile da mappare.
            </div>
          ) : (
            missingDescriptions.map(([normalized, raw]) => (
              <div
                key={normalized}
                className="grid gap-2 rounded-md border p-3 md:grid-cols-[1fr_1fr_auto] md:items-center"
              >
                <div>
                  <div className="font-medium">{raw}</div>
                  <div className="text-xs text-muted-foreground">
                    {normalized}
                  </div>
                </div>
                <Select
                  value={productByDescription[normalized] ?? ""}
                  onValueChange={(value) =>
                    setProductByDescription((current) => ({
                      ...current,
                      [normalized]: value,
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
                <Button
                  variant="outline"
                  disabled={
                    !productByDescription[normalized] || createMapping.isPending
                  }
                  onClick={() => mapDescription(normalized, raw)}
                >
                  Associa
                </Button>
              </div>
            ))
          )}
          {selectedId && (
            <Button
              variant="secondary"
              onClick={() =>
                recalculate.mutate(
                  { id: selectedId },
                  {
                    onSuccess: (result) => void refreshImport(result),
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
        <CardContent className="p-0 overflow-x-auto">
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
                    {party.dataScadenzaRisolta ??
                      (party.errorCodesJson.includes(
                        "SCADENZA_DA_COMPLETARE",
                      ) ? (
                        <Input
                          type="date"
                          className="min-w-36"
                          onBlur={(event) =>
                            event.target.value &&
                            selectedId &&
                            updateParty.mutate(
                              {
                                id: selectedId,
                                partitaId: party.id,
                                data: { dataScadenza: event.target.value },
                              },
                              { onSuccess: () => void refreshImport() },
                            )
                          }
                        />
                      ) : (
                        "—"
                      ))}
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
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Riga</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Prodotto</TableHead>
                <TableHead>Lotto</TableHead>
                <TableHead>Documento</TableHead>
                <TableHead>Stato</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rowsQuery.data?.items.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>{row.numeroRiga}</TableCell>
                  <TableCell>{row.tipoMovimentoEsterno}</TableCell>
                  <TableCell>{row.prodottoRaw}</TableCell>
                  <TableCell>{row.lottoRaw ?? "—"}</TableCell>
                  <TableCell>{row.numeroDocumentoRaw ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant={row.blocking ? "destructive" : "secondary"}>
                      {row.statoRiga}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="border-t p-3 text-xs text-muted-foreground">
            Prime {rowsQuery.data?.items.length ?? 0} di{" "}
            {rowsQuery.data?.total ?? 0} righe; la preview completa è paginata
            lato server e filtrabile via API.
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <StepTitle number={6}>Preflight</StepTitle>
        </CardHeader>
        <CardContent>
          {selected ? (
            <div className="grid gap-3 sm:grid-cols-3 text-sm">
              <div>
                <strong>{selected.partiteSaldoPositivo}</strong> Partite da
                inizializzare
              </div>
              <div>
                <strong>{selected.righeCarico}</strong> carichi storici/positivi
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
              confirm.isPending ||
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
        </CardContent>
      </Card>
    </div>
  );
}
