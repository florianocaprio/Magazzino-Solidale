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
const duplicateQueryTypeExports = [
  "listAgeaImportazioneRigheParams",
  "listFseReconciliationLinesParams",
  "listFseExportEventsParams",
  "listFseExportLinesParams",
  "downloadFseExportParams",
];
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

// Il pacchetto Zod è condiviso con Node e non include i globali DOM File/Blob.
// La validazione autorevole del multipart avviene nel router; nel barrel Zod
// manteniamo quindi un tipo binario Node-safe senza introdurre lib DOM globali.
const generatedZodApiUrl = new URL("../../api-zod/src/generated/api.ts", import.meta.url);
const generatedZodApi = await readFile(generatedZodApiUrl, "utf8");
const fileSchema = "zod.instanceof(File)";
const fileSchemaOccurrences = generatedZodApi.split(fileSchema).length - 1;
if (fileSchemaOccurrences !== 2) {
  throw new Error(`Expected two FSE File schemas, found ${fileSchemaOccurrences}`);
}
await writeFile(
  generatedZodApiUrl,
  generatedZodApi.replaceAll(
    fileSchema,
    "zod.custom<Uint8Array>((value) => value instanceof Uint8Array)",
  ),
);

for (const filename of [
  "beneficiariFseWorkbookUpload.ts",
  "beneficiariFseWorkbookImportUpload.ts",
]) {
  const typeUrl = new URL(`../../api-zod/src/generated/types/${filename}`, import.meta.url);
  const typeSource = await readFile(typeUrl, "utf8");
  const blobOccurrences = typeSource.split("file: Blob;").length - 1;
  if (blobOccurrences !== 1) {
    throw new Error(`Expected one Blob field in ${filename}, found ${blobOccurrences}`);
  }
  await writeFile(typeUrl, typeSource.replace("file: Blob;", "file: Uint8Array;"));
}
