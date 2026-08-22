import { readFile, writeFile } from "node:fs/promises";

const generatedClientUrl = new URL(
  "../../api-client-react/src/generated/api.ts",
  import.meta.url,
);
const source = await readFile(generatedClientUrl, "utf8");
const serialized = `body: JSON.stringify(
      analyzeAgeaImportazioneBody,)`;
const binary = "body: analyzeAgeaImportazioneBody";
const occurrences = source.split(serialized).length - 1;

if (occurrences !== 1) {
  throw new Error(
    `Expected exactly one Orval binary-body serialization, found ${occurrences}`,
  );
}

await writeFile(generatedClientUrl, source.replace(serialized, binary));

// Orval 8 genera nello stesso barrel Zod sia la costante runtime dei path
// params sia il tipo dei query params con il nome
// `ListAgeaImportazioneRigheParams`. Rimuoviamo dal solo barrel Zod il tipo
// duplicato; il client React conserva il proprio tipo query generato.
const generatedZodTypesUrl = new URL(
  "../../api-zod/src/generated/types/index.ts",
  import.meta.url,
);
const zodTypes = await readFile(generatedZodTypesUrl, "utf8");
const duplicateExport = "export * from './listAgeaImportazioneRigheParams';\n";
const duplicateOccurrences = zodTypes.split(duplicateExport).length - 1;
if (duplicateOccurrences !== 1) {
  throw new Error(
    `Expected exactly one duplicate AGEA query type export, found ${duplicateOccurrences}`,
  );
}
await writeFile(generatedZodTypesUrl, zodTypes.replace(duplicateExport, ""));
