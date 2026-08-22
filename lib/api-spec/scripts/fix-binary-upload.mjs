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
