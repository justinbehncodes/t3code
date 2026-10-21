import {
  findSystemBrowserTarget,
  resolveSystemBrowserTarget,
  type EnvironmentId,
  type SystemBrowser,
  type SystemBrowserTarget,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import * as ElectronShell from "../electron/ElectronShell.ts";
import * as DesktopClientSettings from "../settings/DesktopClientSettings.ts";
import {
  buildLaunch,
  candidateBrowsers,
  launchEnvironment,
  profilesFileName,
  profilesFromFile,
  systemBrowserEnvironment,
  type DetectedSystemBrowser,
  type SystemBrowserCandidate,
} from "./systemBrowserDetection.ts";

export class SystemBrowsers extends Context.Service<
  SystemBrowsers,
  {
    /** Detected once per process; `refresh` rescans. */
    readonly list: Effect.Effect<ReadonlyArray<SystemBrowser>>;
    readonly refresh: Effect.Effect<ReadonlyArray<SystemBrowser>>;
    /** False when the URL is not a web URL or the browser or profile is no longer detected. */
    readonly launch: (target: SystemBrowserTarget, rawUrl: unknown) => Effect.Effect<boolean>;
    /**
     * Opens web links in the browser the client settings choose for the environment, then the
     * global choice, then the OS default. Everything else goes straight to the OS handler.
     */
    readonly openExternal: (
      rawUrl: unknown,
      environmentId?: EnvironmentId,
    ) => Effect.Effect<boolean>;
  }
>()("@t3tools/desktop/browser/SystemBrowsers") {}

const parseWebUrl = (rawUrl: unknown) =>
  ElectronShell.parseSafeExternalUrl(rawUrl).pipe(
    Option.filter((url) => url.startsWith("http:") || url.startsWith("https:")),
  );

const toSystemBrowser = ({ id, name, family, profiles }: DetectedSystemBrowser): SystemBrowser => ({
  id,
  name,
  family,
  profiles,
});

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const shell = yield* ElectronShell.ElectronShell;
  const clientSettings = yield* DesktopClientSettings.DesktopClientSettings;
  const platform = yield* HostProcess.Platform;
  const hostEnv = yield* HostProcess.Environment;
  const env = launchEnvironment(hostEnv, platform);

  const isFile = (target: string) =>
    fileSystem.stat(target).pipe(
      Effect.map((info) => info.type === "File"),
      Effect.orElseSucceed(() => false),
    );

  const readProfiles = (browser: Pick<DetectedSystemBrowser, "family" | "userDataDirectory">) =>
    fileSystem
      .readFileString(path.join(browser.userDataDirectory, profilesFileName(browser.family)))
      .pipe(
        Effect.map((contents) => profilesFromFile(browser.family, contents)),
        Effect.orElseSucceed(() => []),
      );

  const detectBrowser = Effect.fn("SystemBrowsers.detectBrowser")(function* (
    candidate: SystemBrowserCandidate,
  ) {
    let executable: string | undefined;
    for (const option of candidate.executables) {
      if (yield* isFile(option)) {
        executable = option;
        break;
      }
    }
    const userDataDirectory = candidate.userDataDirectory;
    if (executable === undefined || userDataDirectory === undefined) return undefined;
    const profiles = yield* readProfiles({ family: candidate.family, userDataDirectory });
    // A browser that was never launched has no profile to choose.
    if (profiles.length === 0) return undefined;
    return {
      id: candidate.id,
      name: candidate.name,
      family: candidate.family,
      executable,
      userDataDirectory,
      profiles,
    } satisfies DetectedSystemBrowser;
  });

  const detect = Effect.forEach(
    candidateBrowsers(platform, systemBrowserEnvironment(hostEnv)),
    detectBrowser,
  ).pipe(
    Effect.map((browsers) => browsers.filter((browser) => browser !== undefined)),
    Effect.withSpan("SystemBrowsers.detect"),
  );
  const [detected, invalidate] = yield* Effect.cachedInvalidateWithTTL(detect, Duration.infinity);

  const launch = Effect.fn("SystemBrowsers.launch")(function* (
    target: SystemBrowserTarget,
    rawUrl: unknown,
  ) {
    const url = parseWebUrl(rawUrl);
    if (Option.isNone(url)) return false;
    const found = findSystemBrowserTarget(yield* detected, target);
    if (found === null) return false;
    // The list is cached for the process, and Chromium silently creates an empty profile for a
    // directory that no longer exists, so re-read this browser's profiles before spawning.
    const current = yield* readProfiles(found.browser);
    if (!current.some((profile) => profile.directory === target.profileDirectory)) {
      yield* Effect.logWarning("The chosen browser profile no longer exists.").pipe(
        Effect.annotateLogs({ browserId: target.browserId }),
      );
      return false;
    }
    const command = buildLaunch(found.browser, found.profile, url.value, platform);
    return yield* spawner
      .spawn(
        ChildProcess.make(command.command, command.args, {
          detached: true,
          stdin: "ignore",
          stdout: "ignore",
          stderr: "ignore",
          env,
          extendEnv: false,
        }),
      )
      .pipe(
        Effect.flatMap((handle) => handle.unref),
        Effect.as(true),
        Effect.scoped,
        Effect.catch((cause) =>
          Effect.logWarning("Could not launch the chosen system browser.", cause).pipe(
            Effect.annotateLogs({ browserId: target.browserId }),
            Effect.as(false),
          ),
        ),
      );
  });

  const openExternal = Effect.fn("SystemBrowsers.openExternal")(function* (
    rawUrl: unknown,
    environmentId?: EnvironmentId,
  ) {
    if (Option.isSome(parseWebUrl(rawUrl))) {
      const settings = yield* clientSettings.get.pipe(Effect.orElseSucceed(() => Option.none()));
      const chosen = Option.getOrUndefined(settings);
      // Skip detection entirely for users who never chose a browser.
      const hasChoice =
        chosen !== undefined &&
        (chosen.browserSystemTarget !== null ||
          (environmentId !== undefined &&
            chosen.browserEnvironmentSystemTargets[environmentId] !== undefined));
      if (hasChoice) {
        const target = resolveSystemBrowserTarget(chosen, yield* detected, environmentId);
        if (target !== null && (yield* launch(target, rawUrl))) return true;
      }
    }
    return yield* shell.openExternal(rawUrl);
  });

  const list = detected.pipe(Effect.map((browsers) => browsers.map(toSystemBrowser)));

  return SystemBrowsers.of({
    list,
    refresh: invalidate.pipe(Effect.andThen(list)),
    launch,
    openExternal,
  });
});

export const layer = Layer.effect(SystemBrowsers, make);
