import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { EnvironmentId } from "./baseSchemas.ts";
import { ClientSettingsPatch, ClientSettingsSchema } from "./settings.ts";
import { resolveSystemBrowserTarget, type SystemBrowser } from "./systemBrowser.ts";

const browsers: ReadonlyArray<SystemBrowser> = [
  {
    id: "msedge",
    name: "Microsoft Edge",
    family: "chromium",
    profiles: [
      { directory: "Default", name: "Profile 1" },
      { directory: "Profile 3", name: "Work" },
      { directory: "Profile 4", name: "Personal" },
    ],
  },
  {
    id: "chrome",
    name: "Google Chrome",
    family: "chromium",
    profiles: [{ directory: "Default", name: "Alice" }],
  },
];

const work = EnvironmentId.make("environment-work");
const home = EnvironmentId.make("environment-home");
const edge = { browserId: "msedge", browserName: "Microsoft Edge" };
const edgeWork = { ...edge, profileDirectory: "Profile 3", profileName: "Work" };
const edgePersonal = { ...edge, profileDirectory: "Profile 4", profileName: "Personal" };
const chrome = {
  browserId: "chrome",
  browserName: "Google Chrome",
  profileDirectory: "Default",
  profileName: "Alice",
};

describe("resolveSystemBrowserTarget", () => {
  const settings = {
    browserSystemTarget: chrome,
    browserEnvironmentSystemTargets: { [work]: edgeWork },
  };

  it("prefers the environment override", () => {
    expect(resolveSystemBrowserTarget(settings, browsers, work)).toEqual(edgeWork);
  });

  it("uses the global choice for other environments and for links without one", () => {
    expect(resolveSystemBrowserTarget(settings, browsers, home)).toEqual(chrome);
    expect(resolveSystemBrowserTarget(settings, browsers)).toEqual(chrome);
  });

  it("returns null for the OS default", () => {
    expect(
      resolveSystemBrowserTarget(
        { browserSystemTarget: null, browserEnvironmentSystemTargets: {} },
        browsers,
        work,
      ),
    ).toBeNull();
  });

  it("skips a target whose profile is no longer detected", () => {
    const missingProfile = { ...edge, profileDirectory: "Profile 9", profileName: "Old" };
    expect(
      resolveSystemBrowserTarget(
        {
          browserSystemTarget: edgePersonal,
          browserEnvironmentSystemTargets: { [work]: missingProfile },
        },
        browsers,
        work,
      ),
    ).toEqual(edgePersonal);
  });

  it("falls back to the OS default when neither target's browser is detected", () => {
    const firefox = {
      browserId: "firefox",
      browserName: "Firefox",
      profileDirectory: "default-release",
      profileName: "default-release",
    };
    expect(
      resolveSystemBrowserTarget(
        { browserSystemTarget: firefox, browserEnvironmentSystemTargets: { [work]: firefox } },
        browsers,
        work,
      ),
    ).toBeNull();
  });
});

describe("system browser targets in client settings", () => {
  const decodeClientSettings = Schema.decodeUnknownSync(ClientSettingsSchema);
  const decodeClientSettingsPatch = Schema.decodeUnknownSync(ClientSettingsPatch);

  it("defaults to the OS default browser with no per-environment choice", () => {
    const settings = decodeClientSettings({});
    expect(settings.browserSystemTarget).toBeNull();
    expect(settings.browserEnvironmentSystemTargets).toEqual({});
  });

  it.each([
    { browserSystemTarget: { browserId: "msedge" } },
    { browserSystemTarget: "msedge" },
    { browserEnvironmentSystemTargets: { [work]: { profileDirectory: "Default" } } },
  ])("rejects a malformed target: %j", (invalid) => {
    expect(() => decodeClientSettings(invalid)).toThrow();
    expect(() => decodeClientSettingsPatch(invalid)).toThrow();
  });
});
