import * as NodePath from "@effect/platform-node/NodePath";
import {
  DEFAULT_CLIENT_SETTINGS,
  EnvironmentId,
  type ClientSettings,
  type SystemBrowserTarget,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PlatformError from "effect/PlatformError";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import { describe, expect, it } from "vite-plus/test";

import * as ElectronShell from "../electron/ElectronShell.ts";
import * as DesktopClientSettings from "../settings/DesktopClientSettings.ts";
import * as SystemBrowsers from "./SystemBrowsers.ts";

const EDGE = "/usr/bin/microsoft-edge";
const EDGE_LOCAL_STATE = "/home/me/.config/microsoft-edge/Local State";
const localState = (directories: ReadonlyArray<string>) =>
  JSON.stringify({
    profile: {
      info_cache: Object.fromEntries(
        directories.map((directory) => [directory, { name: directory }]),
      ),
    },
  });

const edge = (profileDirectory: string): SystemBrowserTarget => ({
  browserId: "msedge",
  browserName: "Microsoft Edge",
  profileDirectory,
  profileName: profileDirectory,
});
const work = EnvironmentId.make("environment-work");

const notFound = (path: string) =>
  PlatformError.systemError({
    _tag: "NotFound",
    module: "FileSystem",
    method: "stat",
    description: "missing",
    pathOrDescriptor: path,
  });

interface Scenario {
  readonly settings?: Partial<ClientSettings>;
  readonly files?: Record<string, string>;
  readonly spawnFails?: boolean;
}

const makeScenario = (scenario: Scenario) => {
  const files = new Map(Object.entries(scenario.files ?? {}));
  const shellOpened: Array<unknown> = [];
  const spawned: Array<{
    readonly command: string;
    readonly args: ReadonlyArray<string>;
    readonly env: Record<string, string | undefined> | undefined;
  }> = [];

  const fileSystem = FileSystem.layerNoop({
    stat: (path) =>
      files.has(path)
        ? Effect.succeed({ type: "File" } as FileSystem.File.Info)
        : Effect.fail(notFound(path)),
    readFileString: (path) => {
      const contents = files.get(path);
      return contents === undefined ? Effect.fail(notFound(path)) : Effect.succeed(contents);
    },
  });

  const spawner = ChildProcessSpawner.make((command) => {
    const {
      command: executable,
      args,
      options,
    } = command as unknown as {
      readonly command: string;
      readonly args: ReadonlyArray<string>;
      readonly options: { readonly env?: Record<string, string | undefined> };
    };
    if (scenario.spawnFails) return Effect.fail(notFound(executable));
    spawned.push({ command: executable, args, env: options.env });
    return Effect.succeed(
      ChildProcessSpawner.makeHandle({
        pid: ChildProcessSpawner.ProcessId(1),
        exitCode: Effect.never,
        isRunning: Effect.succeed(true),
        kill: () => Effect.void,
        unref: Effect.succeed(Effect.void),
        stdin: Sink.drain,
        stdout: Stream.empty,
        stderr: Stream.empty,
        all: Stream.empty,
        getInputFd: () => Sink.drain,
        getOutputFd: () => Stream.empty,
      }),
    );
  });

  const layer = SystemBrowsers.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        NodePath.layerPosix,
        fileSystem,
        Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner),
        Layer.succeed(ElectronShell.ElectronShell, {
          openExternal: (url) =>
            Effect.sync(() => {
              shellOpened.push(url);
              return true;
            }),
          openSystemSettings: () => Effect.succeed(false),
          copyText: () => Effect.void,
        }),
        DesktopClientSettings.layerTest(
          Option.some({ ...DEFAULT_CLIENT_SETTINGS, ...scenario.settings }),
        ),
        Layer.succeed(HostProcess.Platform, "linux"),
        Layer.succeed(HostProcess.Environment, {
          HOME: "/home/me",
          PATH: "/usr/bin",
          CHROME_DESKTOP: "t3code.desktop",
        }),
      ),
    ),
  );

  const run = <A>(
    program: (service: SystemBrowsers.SystemBrowsers["Service"]) => Effect.Effect<A>,
  ) =>
    // oxlint-disable-next-line t3code/no-manual-effect-runtime-in-tests -- @effect/vitest suites fail to load under the workspace runner, so these tests run the program directly.
    Effect.runPromise(
      SystemBrowsers.SystemBrowsers.pipe(Effect.flatMap(program), Effect.provide(layer)),
    );

  return { files, shellOpened, spawned, run };
};

const LINK = "https://example.com/pr/1";

describe("SystemBrowsers.openExternal", () => {
  it("uses the OS handler when no browser was chosen", async () => {
    const scenario = makeScenario({
      files: { [EDGE]: "", [EDGE_LOCAL_STATE]: localState(["Default"]) },
    });
    await scenario.run((service) => service.openExternal(LINK, work));
    expect(scenario.spawned).toEqual([]);
    expect(scenario.shellOpened).toEqual([LINK]);
  });

  it("prefers the environment's browser over the global one", async () => {
    const scenario = makeScenario({
      settings: {
        browserSystemTarget: edge("Default"),
        browserEnvironmentSystemTargets: { [work]: edge("Profile 3") },
      },
      files: { [EDGE]: "", [EDGE_LOCAL_STATE]: localState(["Default", "Profile 3"]) },
    });
    expect(await scenario.run((service) => service.openExternal(LINK, work))).toBe(true);
    expect(await scenario.run((service) => service.openExternal(LINK))).toBe(true);
    expect(scenario.shellOpened).toEqual([]);
    expect(scenario.spawned.map(({ command, args }) => ({ command, args }))).toEqual([
      { command: EDGE, args: ["--profile-directory=Profile 3", LINK] },
      { command: EDGE, args: ["--profile-directory=Default", LINK] },
    ]);
    expect(scenario.spawned[0]?.env).toEqual({ HOME: "/home/me", PATH: "/usr/bin" });
  });

  it("falls back to the OS handler without spawning when the profile disappeared", async () => {
    const scenario = makeScenario({
      settings: { browserSystemTarget: edge("Profile 3") },
      files: { [EDGE]: "", [EDGE_LOCAL_STATE]: localState(["Default", "Profile 3"]) },
    });
    await scenario.run((service) =>
      Effect.gen(function* () {
        expect(yield* service.list).toHaveLength(1);
        // Deleted after the cached scan.
        scenario.files.set(EDGE_LOCAL_STATE, localState(["Default"]));
        yield* service.openExternal(LINK);
      }),
    );
    expect(scenario.spawned).toEqual([]);
    expect(scenario.shellOpened).toEqual([LINK]);
  });

  it("falls back to the OS handler when the browser cannot be started", async () => {
    const scenario = makeScenario({
      settings: { browserSystemTarget: edge("Default") },
      files: { [EDGE]: "", [EDGE_LOCAL_STATE]: localState(["Default"]) },
      spawnFails: true,
    });
    expect(await scenario.run((service) => service.openExternal(LINK))).toBe(true);
    expect(scenario.shellOpened).toEqual([LINK]);
  });

  it("hands non-web links straight to the OS handler", async () => {
    const editorLink = "vscode://vscode-remote/ssh-remote+devbox/home/me/project";
    const scenario = makeScenario({
      settings: { browserSystemTarget: edge("Default") },
      files: { [EDGE]: "", [EDGE_LOCAL_STATE]: localState(["Default"]) },
    });
    await scenario.run((service) => service.openExternal(editorLink));
    expect(scenario.spawned).toEqual([]);
    expect(scenario.shellOpened).toEqual([editorLink]);
  });

  it("does not send the executable path to the renderer", async () => {
    const scenario = makeScenario({
      files: { [EDGE]: "", [EDGE_LOCAL_STATE]: localState(["Default"]) },
    });
    expect(await scenario.run((service) => service.list)).toEqual([
      {
        id: "msedge",
        name: "Microsoft Edge",
        family: "chromium",
        profiles: [{ directory: "Default", name: "Default" }],
      },
    ]);
  });
});
