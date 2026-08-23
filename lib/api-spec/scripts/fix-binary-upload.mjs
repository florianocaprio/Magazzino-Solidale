import { readFile, writeFile } from "node:fs/promises";

const generatedClientUrl = new URL("../../api-client-react/src/generated/api.ts", import.meta.url);
const source = await readFile(generatedClientUrl, "utf8");
const serialized = `body: JSON.stringify(
      analyzeAgeaImportazioneBody,)`;
const binary = "body: analyzeAgeaImportazioneBody";
const occurrences = source.split(serialized).length - 1;

if (occurrences !== 1) {
  throw new Error(`Expected exactly one Orval binary-body serialization, found ${occurrences}`);
}

await writeFile(generatedClientUrl, source.replace(serialized, binary));

// Orval 8 genera nello stesso barrel Zod sia la costante runtime dei path
// params sia il tipo dei query params con il nome
// `ListAgeaImportazioneRigheParams`. Rimuoviamo dal solo barrel Zod il tipo
// duplicato; il client React conserva il proprio tipo query generato.
const generatedZodTypesUrl = new URL("../../api-zod/src/generated/types/index.ts", import.meta.url);
const zodTypes = await readFile(generatedZodTypesUrl, "utf8");
// Stesso conflitto Orval per gli endpoint paginati con path params: la
// costante runtime valida il path, mentre il tipo omonimo descrive i query
// params. I tipi restano disponibili nel client React.
const duplicateQueryTypeExports = ["listAgeaImportazioneRigheParams", "listFseReconciliationLinesParams", "listFseExportEventsParams", "listFseExportLinesParams"];
let fixedZodTypes = zodTypes;
for (const name of duplicateQueryTypeExports) {
  const exportLine = `export * from './${name}';\n`;
  const duplicateOccurrences = fixedZodTypes.split(exportLine).length - 1;
  if (duplicateOccurrences !== 1) {
    throw new Error(`Expected exactly one duplicate ${name} export, found ${duplicateOccurrences}`);
  }
  fixedZodTypes = fixedZodTypes.replace(exportLine, "");
}
await writeFile(generatedZodTypesUrl, fixedZodTypes);
