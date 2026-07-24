export const DATA_SCHEMA_VERSION = 3 as const;

declare const __NEBIKI_APP_VERSION__: string;
declare const __NEBIKI_BUILD_ID__: string;

export const APP_VERSION =
  typeof __NEBIKI_APP_VERSION__ === "string"
    ? __NEBIKI_APP_VERSION__
    : "unknown";

export const BUILD_ID =
  typeof __NEBIKI_BUILD_ID__ === "string" && __NEBIKI_BUILD_ID__.trim()
    ? __NEBIKI_BUILD_ID__
    : "unknown";

export type DataVersionInfo = {
  dataSchemaVersion: number;
  appVersion: string;
  buildId: string;
};

export function getCurrentDataVersionInfo(): DataVersionInfo {
  return {
    dataSchemaVersion: DATA_SCHEMA_VERSION,
    appVersion: APP_VERSION,
    buildId: BUILD_ID,
  };
}

export function normalizeDataVersionInfo(raw: {
  dataSchemaVersion?: unknown;
  appVersion?: unknown;
  buildId?: unknown;
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
    buildId:
      typeof raw.buildId === "string" && raw.buildId.trim()
        ? raw.buildId
        : undefined,
  };
}
