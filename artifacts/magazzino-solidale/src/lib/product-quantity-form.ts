export function suggestedFractionalQuantity(unitOfMeasure: string): boolean {
  return ["kg", "l", "lt"].includes(unitOfMeasure.trim().toLowerCase());
}

export function fractionalQuantityAfterUnitChange(input: {
  unitOfMeasure: string;
  currentValue: boolean;
  explicitlySet: boolean;
}): boolean {
  return input.explicitlySet
    ? input.currentValue
    : suggestedFractionalQuantity(input.unitOfMeasure);
}
