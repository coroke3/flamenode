import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function mapAlias(specifier, baseDir) {
  const mapped = path.join(root, baseDir, specifier.slice(specifier.indexOf("/") + 1));
  if (!path.extname(mapped)) {
    return pathToFileURL(`${mapped}.ts`).href;
  }
  return pathToFileURL(mapped).href;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    return nextResolve(mapAlias(specifier, "src"), context);
  }
  if (specifier.startsWith("@app/")) {
    return nextResolve(mapAlias(specifier, "app"), context);
  }
  return nextResolve(specifier, context);
}
