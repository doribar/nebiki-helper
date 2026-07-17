export const DATA_SCHEMA_VERSION = 2 as const;

declare const __NEBIKI_APP_VERSION__: string;

export const APP_VERSION =
  typeof __NEBIKI_APP_VERSION__ === "string"
    ? __NEBIKI_APP_VERSION__
    : "unknown";

export type DataVersionInfo = {
  dataSchemaVersion: number;
  appVersion: string;
};

export function getCurrentDataVersionInfo(): DataVersionInfo {
  return {
    dataSchemaVersion: DATA_SCHEMA_VERSION,
    appVersion: APP_VERSION,
  };
}

export function normalizeDataVersionInfo(raw: {
  dataSchemaVersion?: unknown;
  appVersion?: unknown;
}): Partial<DataVersionInfo> {
  return {
    dataSchemaVersion:
      typeof raw.dataSchemaVersion === "number" &&
      Number.isInteger(raw.dataSchemaVersion) &&
      raw.dataSchemaVersion >= 1
        ? raw.dataSchemaVersion
        : undefined,
    appVersion:
      typeof raw.appVersion === "string" && raw.appVersion.trim()
        ? raw.appVersion
        : undefined,
  };
}
