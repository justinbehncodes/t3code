import * as Schema from "effect/Schema";

import type { EnvironmentId } from "./baseSchemas.ts";

export const SystemBrowserFamily = Schema.Literals(["chromium", "firefox"]);
export type SystemBrowserFamily = typeof SystemBrowserFamily.Type;

/** For Firefox, `directory` holds the profile name passed to `-P`. */
export const SystemBrowserProfile = Schema.Struct({
  directory: Schema.String,
  name: Schema.String,
});
export type SystemBrowserProfile = typeof SystemBrowserProfile.Type;

export const SystemBrowser = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  family: SystemBrowserFamily,
  profiles: Schema.Array(SystemBrowserProfile),
});
export type SystemBrowser = typeof SystemBrowser.Type;

/**
 * The names are kept from when the target was picked, to label it once it is no longer detected.
 * They are optional so a target saved before they existed still decodes; labels fall back to the ids.
 */
export const SystemBrowserTarget = Schema.Struct({
  browserId: Schema.String,
  profileDirectory: Schema.String,
  browserName: Schema.optionalKey(Schema.String),
  profileName: Schema.optionalKey(Schema.String),
});
export type SystemBrowserTarget = typeof SystemBrowserTarget.Type;

export interface SystemBrowserTargetSettings {
  readonly browserSystemTarget: SystemBrowserTarget | null;
  readonly browserEnvironmentSystemTargets: Readonly<Record<EnvironmentId, SystemBrowserTarget>>;
}

export function findSystemBrowserTarget<Browser extends SystemBrowser>(
  browsers: ReadonlyArray<Browser>,
  target: Pick<SystemBrowserTarget, "browserId" | "profileDirectory"> | null | undefined,
): { readonly browser: Browser; readonly profile: SystemBrowserProfile } | null {
  if (target == null) return null;
  const browser = browsers.find((candidate) => candidate.id === target.browserId);
  const profile = browser?.profiles.find(
    (candidate) => candidate.directory === target.profileDirectory,
  );
  return browser && profile ? { browser, profile } : null;
}

/**
 * Environment override, then the global choice, then null for the OS default. A saved
 * target whose browser or profile is no longer detected is skipped rather than deleted,
 * so it comes back if the browser is reinstalled.
 */
export function resolveSystemBrowserTarget(
  settings: SystemBrowserTargetSettings,
  browsers: ReadonlyArray<SystemBrowser>,
  environmentId?: EnvironmentId,
): SystemBrowserTarget | null {
  const candidates = [
    environmentId === undefined
      ? undefined
      : settings.browserEnvironmentSystemTargets[environmentId],
    settings.browserSystemTarget,
  ];
  for (const candidate of candidates) {
    if (candidate != null && findSystemBrowserTarget(browsers, candidate) !== null) {
      return candidate;
    }
  }
  return null;
}
