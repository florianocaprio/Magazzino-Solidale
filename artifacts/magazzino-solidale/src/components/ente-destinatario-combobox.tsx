import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { EnteDestinatario } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export function EnteDestinatarioCombobox({
  items,
  value,
  onChange,
  searchValue,
  onSearchChange,
  areaNames,
  selectedLabel,
}: {
  items: EnteDestinatario[];
  value: string;
  onChange: (item: EnteDestinatario) => void;
  searchValue: string;
  onSearchChange: (value: string) => void;
  areaNames: ReadonlyMap<number, string>;
  selectedLabel?: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const selected = items.find((item) => String(item.id) === value);
  const label = selected?.denominazione ?? selectedLabel;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          role="combobox"
          aria-expanded={open}
          variant="outline"
          className={cn(
            "w-full justify-between font-normal",
            !label && "text-muted-foreground",
          )}
        >
          <span className="truncate">{label ?? t("entiEsterni.choose")}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[--radix-popover-trigger-width] p-0"
        align="start"
      >
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={t("entiEsterni.search")}
            value={searchValue}
            onValueChange={onSearchChange}
          />
          <CommandList>
            <CommandEmpty>
              {searchValue.trim().length === 1
                ? t("entiEsterni.minSearch")
                : t("entiEsterni.none")}
            </CommandEmpty>
            <CommandGroup>
              {items.map((item) => (
                <CommandItem
                  key={item.id}
                  value={String(item.id)}
                  onSelect={() => {
                    onChange(item);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value === String(item.id) ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span className="truncate">
                    {item.denominazione} · {item.indirizzo} ·{" "}
                    {areaNames.get(item.areaOperativaId) ??
                      item.areaOperativaId}
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
