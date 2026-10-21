import type { SystemBrowser, SystemBrowserFamily, SystemBrowserProfile } from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { isSafeProfileDirectory } from "../preview/BrowserImport/Sources.ts";

type WindowsRoot = "ProgramFiles" | "ProgramFiles(x86)" | "LOCALAPPDATA";

interface SystemBrowserDefinition {
  readonly id: string;
  readonly name: string;
  readonly family: SystemBrowserFamily;
  readonly windows: {
    readonly roots: ReadonlyArray<WindowsRoot>;
    readonly executable: ReadonlyArray<string>;
    /** Under `%LOCALAPPDATA%` for Chromium, `%APPDATA%` for Firefox. */
    readonly userData: ReadonlyArray<string>;
  };
  readonly darwin: {
    readonly app: string;
    readonly binary: string;
    /** Under `~/Library/Application Support`. */
    readonly userData: ReadonlyArray<string>;
  };
  readonly linux: {
    readonly commands: ReadonlyArray<string>;
    /** Under the home directory. */
    readonly userData: ReadonlyArray<string>;
  };
}

const ALL_WINDOWS_ROOTS: ReadonlyArray<WindowsRoot> = [
  "ProgramFiles",
  "ProgramFiles(x86)",
  "LOCALAPPDATA",
];

const SYSTEM_BROWSERS: ReadonlyArray<SystemBrowserDefinition> = [
  {
    id: "chrome",
    name: "Google Chrome",
    family: "chromium",
    windows: {
      roots: ALL_WINDOWS_ROOTS,
      executable: ["Google", "Chrome", "Application", "chrome.exe"],
      userData: ["Google", "Chrome", "User Data"],
    },
    darwin: {
      app: "Google Chrome.app",
      binary: "Google Chrome",
      userData: ["Google", "Chrome"],
    },
    linux: {
      commands: ["google-chrome", "google-chrome-stable"],
      userData: [".config", "google-chrome"],
    },
  },
  {
    id: "msedge",
    name: "Microsoft Edge",
    family: "chromium",
    windows: {
      roots: ALL_WINDOWS_ROOTS,
      executable: ["Microsoft", "Edge", "Application", "msedge.exe"],
      userData: ["Microsoft", "Edge", "User Data"],
    },
    darwin: {
      app: "Microsoft Edge.app",
      binary: "Microsoft Edge",
      userData: ["Microsoft Edge"],
    },
    linux: {
      commands: ["microsoft-edge", "microsoft-edge-stable"],
      userData: [".config", "microsoft-edge"],
    },
  },
  {
    id: "brave",
    name: "Brave",
    family: "chromium",
    windows: {
      roots: ALL_WINDOWS_ROOTS,
      executable: ["BraveSoftware", "Brave-Browser", "Application", "brave.exe"],
      userData: ["BraveSoftware", "Brave-Browser", "User Data"],
    },
    darwin: {
      app: "Brave Browser.app",
      binary: "Brave Browser",
      userData: ["BraveSoftware", "Brave-Browser"],
    },
    linux: {
      commands: ["brave-browser", "brave"],
      userData: [".config", "BraveSoftware", "Brave-Browser"],
    },
  },
  {
    id: "vivaldi",
    name: "Vivaldi",
    family: "chromium",
    windows: {
      roots: ALL_WINDOWS_ROOTS,
      executable: ["Vivaldi", "Application", "vivaldi.exe"],
      userData: ["Vivaldi", "User Data"],
    },
    darwin: { app: "Vivaldi.app", binary: "Vivaldi", userData: ["Vivaldi"] },
    linux: { commands: ["vivaldi", "vivaldi-stable"], userData: [".config", "vivaldi"] },
  },
  {
    id: "chromium",
    name: "Chromium",
    family: "chromium",
    windows: {
      roots: ["LOCALAPPDATA"],
      executable: ["Chromium", "Application", "chrome.exe"],
      userData: ["Chromium", "User Data"],
    },
    darwin: { app: "Chromium.app", binary: "Chromium", userData: ["Chromium"] },
    linux: { commands: ["chromium", "chromium-browser"], userData: [".config", "chromium"] },
  },
  {
    id: "firefox",
    name: "Firefox",
    family: "firefox",
    windows: {
      roots: ["ProgramFiles", "ProgramFiles(x86)"],
      executable: ["Mozilla Firefox", "firefox.exe"],
      userData: ["Mozilla", "Firefox"],
    },
    darwin: { app: "Firefox.app", binary: "firefox", userData: ["Firefox"] },
    linux: { commands: ["firefox"], userData: [".mozilla", "firefox"] },
  },
];

export interface SystemBrowserEnvironment {
  readonly home: string;
  readonly appData: string | undefined;
  readonly localAppData: string | undefined;
  readonly programFiles: string | undefined;
  readonly programFilesX86: string | undefined;
  readonly path: string | undefined;
}

export function systemBrowserEnvironment(
  env: Readonly<Record<string, string | undefined>>,
): SystemBrowserEnvironment {
  return {
    home: env.HOME ?? env.USERPROFILE ?? "",
    appData: env.APPDATA,
    localAppData: env.LOCALAPPDATA,
    programFiles: env.ProgramFiles ?? env.PROGRAMFILES,
    programFilesX86: env["ProgramFiles(x86)"] ?? env["PROGRAMFILES(X86)"],
    path: env.PATH ?? env.Path,
  };
}

export interface SystemBrowserCandidate {
  readonly id: string;
  readonly name: string;
  readonly family: SystemBrowserFamily;
  /** In preference order; the first that exists wins. */
  readonly executables: ReadonlyArray<string>;
  /** Chromium `User Data` directory, or the directory holding Firefox's `profiles.ini`. */
  readonly userDataDirectory: string | undefined;
}

const joinFor = (platform: NodeJS.Platform) => {
  const separator = platform === "win32" ? "\\" : "/";
  return (...segments: ReadonlyArray<string>) => segments.join(separator);
};

/** What main needs to launch and re-check a browser; the renderer only sees `SystemBrowser`. */
export interface DetectedSystemBrowser extends SystemBrowser {
  readonly executable: string;
  readonly userDataDirectory: string;
}

/** Known install locations only; the Windows registry is not consulted. */
export function candidateBrowsers(
  platform: NodeJS.Platform,
  env: SystemBrowserEnvironment,
): ReadonlyArray<SystemBrowserCandidate> {
  const join = joinFor(platform);
  return SYSTEM_BROWSERS.map((definition): SystemBrowserCandidate => {
    const base = { id: definition.id, name: definition.name, family: definition.family };
    if (platform === "win32") {
      const roots: Record<WindowsRoot, string | undefined> = {
        ProgramFiles: env.programFiles,
        "ProgramFiles(x86)": env.programFilesX86,
        LOCALAPPDATA: env.localAppData,
      };
      const userDataRoot = definition.family === "firefox" ? env.appData : env.localAppData;
      return {
        ...base,
        executables: definition.windows.roots.flatMap((root) => {
          const directory = roots[root];
          return directory ? [join(directory, ...definition.windows.executable)] : [];
        }),
        userDataDirectory: userDataRoot
          ? join(userDataRoot, ...definition.windows.userData)
          : undefined,
      };
    }
    if (platform === "darwin") {
      return {
        ...base,
        executables: ["/Applications", join(env.home, "Applications")].map((directory) =>
          join(directory, definition.darwin.app, "Contents", "MacOS", definition.darwin.binary),
        ),
        userDataDirectory: join(
          env.home,
          "Library",
          "Application Support",
          ...definition.darwin.userData,
        ),
      };
    }
    const pathEntries = (env.path ?? "").split(":").filter((entry) => entry.length > 0);
    return {
      ...base,
      executables: definition.linux.commands.flatMap((command) =>
        pathEntries.map((directory) => join(directory, command)),
      ),
      userDataDirectory: join(env.home, ...definition.linux.userData),
    };
  });
}

const LocalState = Schema.Struct({
  profile: Schema.optional(
    Schema.Struct({
      info_cache: Schema.optional(
        Schema.Record(Schema.String, Schema.Struct({ name: Schema.optional(Schema.String) })),
      ),
    }),
  ),
});
const decodeLocalState = Schema.decodeUnknownOption(Schema.fromJsonString(LocalState));

/** Profiles from a Chromium `Local State` file's `profile.info_cache`. */
export function chromiumProfilesFromLocalState(json: string): ReadonlyArray<SystemBrowserProfile> {
  return Option.match(decodeLocalState(json), {
    onNone: () => [],
    onSome: (state) =>
      Object.entries(state.profile?.info_cache ?? {})
        .filter(([directory]) => isSafeProfileDirectory(directory))
        .map(([directory, info]) => ({ directory, name: info.name?.trim() || directory })),
  });
}

/**
 * Profiles from Firefox's `profiles.ini`, keyed by name because that is what `-P` takes.
 * `Install*` sections point at a default profile but do not describe one. A name starting
 * with `-` would be read as another flag after `-P`, so it is skipped.
 */
export function firefoxProfilesFromIni(ini: string): ReadonlyArray<SystemBrowserProfile> {
  const names = new Set<string>();
  let inProfile = false;
  for (const rawLine of ini.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith("[")) {
      inProfile = /^\[Profile\d+\]$/i.test(line);
      continue;
    }
    const separator = line.indexOf("=");
    if (!inProfile || separator === -1) continue;
    if (line.slice(0, separator).trim().toLowerCase() !== "name") continue;
    const name = line.slice(separator + 1).trim();
    if (name.length > 0 && !name.startsWith("-") && !name.includes("\u0000")) names.add(name);
  }
  return [...names].map((name) => ({ directory: name, name }));
}

/** The file under the user data directory that lists a browser's profiles. */
export function profilesFileName(family: SystemBrowserFamily): string {
  return family === "firefox" ? "profiles.ini" : "Local State";
}

export function profilesFromFile(
  family: SystemBrowserFamily,
  contents: string,
): ReadonlyArray<SystemBrowserProfile> {
  return family === "firefox"
    ? firefoxProfilesFromIni(contents)
    : chromiumProfilesFromLocalState(contents);
}

/**
 * A browser passes its environment on to everything started from it, so drop Electron's
 * run-as-node switch. On Linux, Chromium reads `CHROME_DESKTOP` to pick the desktop entry its
 * windows group under, which would otherwise be T3 Code's.
 */
export function launchEnvironment(
  env: Readonly<Record<string, string | undefined>>,
  platform: NodeJS.Platform,
): Record<string, string | undefined> {
  const { ELECTRON_RUN_AS_NODE: _runAsNode, ...rest } = env;
  if (platform !== "linux") return rest;
  const { CHROME_DESKTOP: _desktopEntry, ...linux } = rest;
  return linux;
}

export interface SystemBrowserLaunch {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
}

/** Arguments are always passed as an array, never through a shell. */
export function buildLaunch(
  browser: Pick<DetectedSystemBrowser, "family" | "executable">,
  profile: SystemBrowserProfile,
  url: string,
  platform: NodeJS.Platform,
): SystemBrowserLaunch {
  if (browser.family === "firefox") {
    return { command: browser.executable, args: ["-P", profile.directory, "-new-tab", url] };
  }
  const profileArg = `--profile-directory=${profile.directory}`;
  const appBundle = browser.executable.match(/^(.*\.app)\/Contents\/MacOS\/[^/]+$/)?.[1];
  // LaunchServices starts the browser as its own app rather than a child of T3 Code; a running
  // instance still receives the arguments through Chromium's process singleton.
  if (platform === "darwin" && appBundle !== undefined) {
    return { command: "open", args: ["-na", appBundle, "--args", profileArg, url] };
  }
  return { command: browser.executable, args: [profileArg, url] };
}
