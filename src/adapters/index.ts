import { SeoDataResult, SeoDataSource } from "../core/types";

export type { SeoDataSource };

export function resolveDataSource(): SeoDataSource {
  const raw = (process.env.SEO_DATA_SOURCE ?? "mock").trim().toLowerCase();
  if (raw === "mock" || raw === "search_console") return raw;
  throw new Error(
    `SEO_DATA_SOURCE desconocido: "${raw}". Valores validos: "mock" o "search_console".`
  );
}

/**
 * Single place that decides which adapter feeds the SEO Watcher Agent.
 * Both branches implement the exact same signature (Promise<SeoDataResult>),
 * so src/agents/seo-watcher.ts never needs to know which one is active.
 */
export async function getSeoData(): Promise<SeoDataResult> {
  const source = resolveDataSource();

  if (source === "mock") {
    const { getSearchConsoleData } = await import("./search-console-placeholder");
    return getSearchConsoleData();
  }

  const { getSearchConsoleData } = await import("./search-console");
  return getSearchConsoleData();
}
