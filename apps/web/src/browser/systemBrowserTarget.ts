import {
  findSystemBrowserTarget,
  type EnvironmentId,
  type SystemBrowser,
  type SystemBrowserTarget,
} from "@t3tools/contracts";

/** Browser ids never contain `:`, so plain select values without one cannot collide. */
export function systemBrowserTargetValue(
  target: Pick<SystemBrowserTarget, "browserId" | "profileDirectory">,
): string {
  return `${target.browserId}:${target.profileDirectory}`;
}

export interface SystemBrowserTargetOption {
  readonly value: string;
  readonly label: string;
  readonly target: SystemBrowserTarget;
}

export interface SystemBrowserTargetOptions {
  readonly groups: ReadonlyArray<{
    readonly browserId: string;
    readonly browserName: string;
    readonly options: ReadonlyArray<SystemBrowserTargetOption>;
  }>;
  /** Saved choices whose browser or profile is gone stay listed, so they remain visible. */
  readonly missing: ReadonlyArray<SystemBrowserTargetOption>;
}

/**
 * `browsers` is null until the first scan answers, so a saved choice is not flagged as missing
 * while detection is still running. Detected names win over the names saved with the target.
 */
export function systemBrowserTargetLabel(
  browsers: ReadonlyArray<SystemBrowser> | null,
  target: SystemBrowserTarget,
): string {
  const found = findSystemBrowserTarget(browsers ?? [], target);
  if (found) return `${found.browser.name} · ${found.profile.name}`;
  const saved = `${target.browserName} · ${target.profileName}`;
  return browsers === null ? saved : `${saved} (not found)`;
}

export function systemBrowserTargetOptions(
  browsers: ReadonlyArray<SystemBrowser> | null,
  savedTargets: ReadonlyArray<SystemBrowserTarget | null | undefined>,
): SystemBrowserTargetOptions {
  const groups = (browsers ?? []).map((browser) => ({
    browserId: browser.id,
    browserName: browser.name,
    options: browser.profiles.map((profile) => {
      const target = {
        browserId: browser.id,
        browserName: browser.name,
        profileDirectory: profile.directory,
        profileName: profile.name,
      };
      return { value: systemBrowserTargetValue(target), label: profile.name, target };
    }),
  }));
  const missing = new Map<string, SystemBrowserTargetOption>();
  for (const target of savedTargets) {
    if (target == null || findSystemBrowserTarget(browsers ?? [], target) !== null) continue;
    const value = systemBrowserTargetValue(target);
    missing.set(value, { value, label: systemBrowserTargetLabel(browsers, target), target });
  }
  return { groups, missing: [...missing.values()] };
}

export function findSystemBrowserTargetOption(
  options: SystemBrowserTargetOptions,
  value: string,
): SystemBrowserTarget | null {
  for (const option of [...options.groups.flatMap((group) => group.options), ...options.missing]) {
    if (option.value === value) return option.target;
  }
  return null;
}

export function withEnvironmentSystemTarget(
  current: Readonly<Record<EnvironmentId, SystemBrowserTarget>>,
  environmentId: EnvironmentId,
  target: SystemBrowserTarget | null,
): Record<EnvironmentId, SystemBrowserTarget> {
  const { [environmentId]: _previous, ...rest } = current;
  return target === null ? rest : { ...rest, [environmentId]: target };
}

/** Saved per-environment choices for environments this client no longer lists. */
export function removedEnvironmentSystemTargets(
  current: Readonly<Record<EnvironmentId, SystemBrowserTarget>>,
  listedEnvironmentIds: ReadonlyArray<EnvironmentId>,
): ReadonlyArray<readonly [EnvironmentId, SystemBrowserTarget]> {
  const listed = new Set<string>(listedEnvironmentIds);
  return (Object.entries(current) as Array<[EnvironmentId, SystemBrowserTarget]>).filter(
    ([environmentId]) => !listed.has(environmentId),
  );
}
