import * as fs from "fs";
import * as path from "path";
import { SearchConsoleRow, SeoDataResult } from "../core/types";

const SAMPLE_DATA_PATH = path.join(
  __dirname,
  "..",
  "..",
  "data",
  "sample-search-console-data.json"
);

interface SampleDataFile {
  siteUrl: string;
  dateRange: { start: string; end: string };
  rows: SearchConsoleRow[];
}

/**
 * PLACEHOLDER adapter. Reads local mock data only — never calls the real
 * Google Search Console API and never needs credentials.
 *
 * When the real integration is built, it must implement this exact same
 * signature (Promise<SeoDataResult>) and stay READ-ONLY: list/query
 * report data, no mutate/write calls of any kind.
 */
export async function getSearchConsoleData(): Promise<SeoDataResult> {
  const raw = fs.readFileSync(SAMPLE_DATA_PATH, "utf-8");
  const parsed = JSON.parse(raw) as SampleDataFile;
  return {
    rows: parsed.rows,
    siteUrl: parsed.siteUrl,
    analysisStartDate: parsed.dateRange.start,
    analysisEndDate: parsed.dateRange.end,
  };
}
