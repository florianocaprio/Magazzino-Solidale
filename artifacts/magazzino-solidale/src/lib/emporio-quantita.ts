export type ConfigurazioneQuantitaEmporio = {
  min: number;
  step: number;
  incremento: number;
};

export function configurazioneQuantitaEmporio(
  unitaMisura: string | null | undefined,
): ConfigurazioneQuantitaEmporio {
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
