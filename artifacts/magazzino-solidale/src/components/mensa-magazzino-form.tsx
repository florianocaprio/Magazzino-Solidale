import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
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
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";

const NO_CENTRO = "__none__";

export type MensaMagazzinoValues = {
  codice: string;
  nome: string;
  cittaId: number;
  centroAscoltoId: number | null;
  indirizzo: string;
  comune: string;
  zona: string;
  responsabile: string;
  telefono: string;
  email: string;
  stato: "attivo" | "inattivo";
  note: string;
};

type AreaOption = { id: number; nome: string };
type CentroOption = {
  id: number;
  nome: string;
  cittaId?: number | null;
  attivo?: boolean;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: MensaMagazzinoValues) => void;
  areas: AreaOption[];
  centri: CentroOption[];
  lockedAreaId?: number | null;
  lockedCentroId?: number | null;
  pending?: boolean;
};

type FormState = Omit<MensaMagazzinoValues, "cittaId" | "centroAscoltoId"> & {
  cittaId: string;
  centroAscoltoId: string;
};

function initialState(
  lockedAreaId?: number | null,
  lockedCentroId?: number | null,
): FormState {
  return {
    codice: "",
    nome: "",
    cittaId: lockedAreaId != null ? String(lockedAreaId) : "",
    centroAscoltoId:
      lockedCentroId != null ? String(lockedCentroId) : NO_CENTRO,
    indirizzo: "",
    comune: "",
    zona: "",
    responsabile: "",
    telefono: "",
    email: "",
    stato: "attivo",
    note: "",
  };
}

export function MensaMagazzinoForm({
  open,
  onOpenChange,
  onSubmit,
  areas,
  centri,
  lockedAreaId = null,
  lockedCentroId = null,
  pending = false,
}: Props) {
  const previousOpen = useRef(false);
  const [form, setForm] = useState<FormState>(() =>
    initialState(lockedAreaId, lockedCentroId),
  );

  useEffect(() => {
    if (open && !previousOpen.current) {
      setForm(initialState(lockedAreaId, lockedCentroId));
    }
    previousOpen.current = open;
  }, [lockedAreaId, lockedCentroId, open]);

  const selectedAreaId = form.cittaId ? Number(form.cittaId) : null;
  const centriArea = centri.filter(
    (centro) =>
      centro.attivo !== false &&
      selectedAreaId != null &&
      centro.cittaId === selectedAreaId,
  );

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.cittaId || !form.nome.trim()) return;
    onSubmit({
      ...form,
      codice: form.codice.trim(),
      nome: form.nome.trim(),
      cittaId: Number(form.cittaId),
      centroAscoltoId:
        form.centroAscoltoId === NO_CENTRO
          ? null
          : Number(form.centroAscoltoId),
    });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Nuova Mensa</SheetTitle>
          <SheetDescription>
            Compila i dettagli della sede Mensa e del relativo magazzino.
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={submit} className="mt-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="mensa-codice">Codice</Label>
              <Input
                id="mensa-codice"
                placeholder="Lascia vuoto per generare"
                value={form.codice}
                onChange={(event) => update("codice", event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Stato</Label>
              <Select
                value={form.stato}
                onValueChange={(value: "attivo" | "inattivo") =>
                  update("stato", value)
                }
              >
                <SelectTrigger aria-label="Stato">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="attivo">Attivo</SelectItem>
                  <SelectItem value="inattivo">Inattivo</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Tipo magazzino</Label>
            <Select value="mensa" disabled>
              <SelectTrigger aria-label="Tipo magazzino">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="mensa">Mensa</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Centro di Ascolto</Label>
            <Select
              value={form.centroAscoltoId}
              disabled={lockedCentroId != null || selectedAreaId == null}
              onValueChange={(value) => update("centroAscoltoId", value)}
            >
              <SelectTrigger aria-label="Centro di Ascolto">
                <SelectValue
                  placeholder={
                    selectedAreaId == null
                      ? "Seleziona prima l'area"
                      : "Comune a tutti i centri"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_CENTRO}>
                  Comune a tutti i centri
                </SelectItem>
                {centriArea.map((centro) => (
                  <SelectItem key={centro.id} value={String(centro.id)}>
                    {centro.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Area</Label>
            <Select
              value={form.cittaId}
              disabled={lockedAreaId != null}
              onValueChange={(value) =>
                setForm((current) => ({
                  ...current,
                  cittaId: value,
                  centroAscoltoId:
                    lockedCentroId != null ? String(lockedCentroId) : NO_CENTRO,
                }))
              }
            >
              <SelectTrigger aria-label="Area">
                <SelectValue placeholder="Seleziona area" />
              </SelectTrigger>
              <SelectContent>
                {areas.map((area) => (
                  <SelectItem key={area.id} value={String(area.id)}>
                    {area.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="mensa-nome">Nome</Label>
            <Input
              id="mensa-nome"
              required
              placeholder="Mensa..."
              value={form.nome}
              onChange={(event) => update("nome", event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="mensa-indirizzo">Indirizzo</Label>
            <Input
              id="mensa-indirizzo"
              value={form.indirizzo}
              onChange={(event) => update("indirizzo", event.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="mensa-comune">Comune</Label>
              <Input
                id="mensa-comune"
                value={form.comune}
                onChange={(event) => update("comune", event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="mensa-zona">Zona</Label>
              <Input
                id="mensa-zona"
                placeholder="Es: Nord"
                value={form.zona}
                onChange={(event) => update("zona", event.target.value)}
              />
            </div>
          </div>

          <div className="space-y-4 border-t pt-4">
            <h4 className="text-sm font-medium">Contatti</h4>
            <div className="space-y-2">
              <Label htmlFor="mensa-responsabile">Responsabile</Label>
              <Input
                id="mensa-responsabile"
                value={form.responsabile}
                onChange={(event) => update("responsabile", event.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="mensa-telefono">Telefono</Label>
                <Input
                  id="mensa-telefono"
                  value={form.telefono}
                  onChange={(event) => update("telefono", event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="mensa-email">Email</Label>
                <Input
                  id="mensa-email"
                  type="email"
                  value={form.email}
                  onChange={(event) => update("email", event.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="space-y-2 border-t pt-4">
            <Label htmlFor="mensa-note">Note</Label>
            <Textarea
              id="mensa-note"
              value={form.note}
              onChange={(event) => update("note", event.target.value)}
            />
          </div>

          <div className="flex justify-end gap-2 pt-6">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Annulla
            </Button>
            <Button type="submit" disabled={pending || !form.cittaId}>
              Crea Mensa
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
