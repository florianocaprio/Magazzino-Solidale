import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type BeneficiarioOption = {
  id: number;
  nome: string;
  cognome: string;
  codice?: string | null;
};

/**
 * Picker beneficiario con ricerca testuale (typeahead) per nome/cognome/codice.
 * `items` è la lista filtrata mostrata; `selectedLabelFallback` permette di
 * risolvere l'etichetta anche quando il selezionato non è in `items`
 * (es. impostato via scansione codice a barre).
 */
export function BeneficiarioCombobox({
  items,
  value,
  onChange,
  placeholder,
  emptyText,
  disabled,
  selectedLabelFallback,
}: {
  items: BeneficiarioOption[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  emptyText?: string;
  disabled?: boolean;
  selectedLabelFallback?: string | null;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const selected = items.find((b) => String(b.id) === value);
  const label = selected
    ? `${selected.cognome} ${selected.nome}`
    : selectedLabelFallback || (placeholder ?? t("common.select"));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn("w-full justify-between font-normal", !selected && !selectedLabelFallback && "text-muted-foreground")}
        >
          <span className="truncate">{label}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput placeholder={t("common.searchByNameOrCode")} />
          <CommandList>
            <CommandEmpty>{emptyText ?? t("common.noResults")}</CommandEmpty>
            <CommandGroup>
              {items.map((b) => (
                <CommandItem
                  key={b.id}
                  value={`${b.cognome} ${b.nome} ${b.codice ?? ""}`}
                  onSelect={() => {
                    onChange(String(b.id));
                    setOpen(false);
                  }}
                >
                  <Check className={cn("mr-2 h-4 w-4", value === String(b.id) ? "opacity-100" : "opacity-0")} />
                  <span className="truncate">
                    {b.cognome} {b.nome}
                    {b.codice ? <span className="ml-2 text-xs text-muted-foreground">{b.codice}</span> : null}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
