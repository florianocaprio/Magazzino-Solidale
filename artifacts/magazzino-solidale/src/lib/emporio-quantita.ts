export type ConfigurazioneQuantitaEmporio = {
  min: number;
  step: number;
  incremento: number;
};

export function configurazioneQuantitaEmporio(
  unitaMisura: string | null | undefined,
  quantitaFrazionabile?: boolean | null,
): ConfigurazioneQuantitaEmporio {
  if (quantitaFrazionabile === false) return { min: 1, step: 1, incremento: 1 };
  if (quantitaFrazionabile === true)
    return {
      min: 0.000001,
      step: 0.000001,
      incremento: ["kg", "l", "lt"].includes(
        unitaMisura?.trim().toLowerCase() ?? "",
      )
        ? 0.25
        : 1,
    };
  switch (unitaMisura?.trim().toLowerCase()) {
    case "pz":
      return { min: 1, step: 1, incremento: 1 };
    case "g":
    case "ml":
      return { min: 0.01, step: 0.01, incremento: 1 };
    case "kg":
    case "l":
      return { min: 0.01, step: 0.01, incremento: 0.25 };
    default:
      return { min: 0.01, step: 0.01, incremento: 0.25 };
  }
}
