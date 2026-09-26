import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** Compare full file URLs, not basenames or slash-split argv (Windows #458). */
export function isCli(moduleUrl, entry = process.argv[1]) {
  return Boolean(entry) && pathToFileURL(resolve(entry)).href === moduleUrl;
}
