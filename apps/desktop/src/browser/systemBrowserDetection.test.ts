import { describe, expect, it } from "vite-plus/test";

import {
  buildLaunch,
  candidateBrowsers,
  chromiumProfilesFromLocalState,
  firefoxProfilesFromIni,
  launchEnvironment,
  systemBrowserEnvironment,
  type DetectedSystemBrowser,
} from "./systemBrowserDetection.ts";

const windowsEnv = systemBrowserEnvironment({
  USERPROFILE: "C:\\Users\\alice",
  APPDATA: "C:\\Users\\alice\\AppData\\Roaming",
  LOCALAPPDATA: "C:\\Users\\alice\\AppData\\Local",
  ProgramFiles: "C:\\Program Files",
  "ProgramFiles(x86)": "C:\\Program Files (x86)",
});

describe("candidateBrowsers", () => {
  it("probes Program Files, Program Files (x86) and Local AppData on Windows", () => {
    const edge = candidateBrowsers("win32", windowsEnv).find((browser) => browser.id === "msedge");
    expect(edge?.executables).toContain(
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    );
    expect(edge?.userDataDirectory).toBe(
      "C:\\Users\\alice\\AppData\\Local\\Microsoft\\Edge\\User Data",
    );

    const chrome = candidateBrowsers("win32", windowsEnv).find(
      (browser) => browser.id === "chrome",
    );
    expect(chrome?.executables[0]).toBe(
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    );
  });

  it("keeps Firefox profiles under Roaming AppData on Windows", () => {
    const firefox = candidateBrowsers("win32", windowsEnv).find(
      (browser) => browser.id === "firefox",
    );
    expect(firefox?.family).toBe("firefox");
    expect(firefox?.userDataDirectory).toBe("C:\\Users\\alice\\AppData\\Roaming\\Mozilla\\Firefox");
  });

  it("uses application bundles on macOS", () => {
    const chrome = candidateBrowsers(
      "darwin",
      systemBrowserEnvironment({ HOME: "/Users/alice" }),
    ).find((browser) => browser.id === "chrome");
    expect(chrome?.executables).toEqual([
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Users/alice/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    ]);
    expect(chrome?.userDataDirectory).toBe(
      "/Users/alice/Library/Application Support/Google/Chrome",
    );
  });

  it("looks commands up on PATH on Linux", () => {
    const chromium = candidateBrowsers(
      "linux",
      systemBrowserEnvironment({ HOME: "/home/alice", PATH: "/usr/local/bin:/usr/bin" }),
    ).find((browser) => browser.id === "chromium");
    expect(chromium?.executables).toEqual([
      "/usr/local/bin/chromium",
      "/usr/bin/chromium",
      "/usr/local/bin/chromium-browser",
      "/usr/bin/chromium-browser",
    ]);
    expect(chromium?.userDataDirectory).toBe("/home/alice/.config/chromium");
  });
});

describe("chromiumProfilesFromLocalState", () => {
  it("reads Edge's profiles with their display names", () => {
    const localState = JSON.stringify({
      profile: {
        info_cache: {
          Default: { name: "Profile 1" },
          "Profile 3": { name: "Work" },
          "Profile 4": { name: "Personal" },
        },
      },
    });
    expect(chromiumProfilesFromLocalState(localState)).toEqual([
      { directory: "Default", name: "Profile 1" },
      { directory: "Profile 3", name: "Work" },
      { directory: "Profile 4", name: "Personal" },
    ]);
  });

  it("reads Chrome's single profile and ignores unrelated fields", () => {
    const localState = JSON.stringify({
      profile: { info_cache: { Default: { name: "Alice", gaia_name: "Alice Example" } } },
    });
    expect(chromiumProfilesFromLocalState(localState)).toEqual([
      { directory: "Default", name: "Alice" },
    ]);
  });

  it("falls back to the directory name and drops unsafe directories", () => {
    const localState = JSON.stringify({
      profile: { info_cache: { "Profile 2": {}, "..": { name: "Escape" }, "a\\b": { name: "X" } } },
    });
    expect(chromiumProfilesFromLocalState(localState)).toEqual([
      { directory: "Profile 2", name: "Profile 2" },
    ]);
  });

  it("returns nothing for a malformed file", () => {
    expect(chromiumProfilesFromLocalState("{not json")).toEqual([]);
    expect(chromiumProfilesFromLocalState(JSON.stringify({ profile: "x" }))).toEqual([]);
  });
});

describe("firefoxProfilesFromIni", () => {
  it("lists [ProfileN] sections by name and skips Install sections", () => {
    const ini = [
      "[Install308046B0AF4A39CB]",
      "Default=Profiles/abcd.default-release",
      "Locked=1",
      "",
      "[Profile1]",
      "Name=default",
      "IsRelative=1",
      "Path=Profiles/efgh.default",
      "Default=1",
      "",
      "[Profile0]",
      "Name=default-release",
      "IsRelative=1",
      "Path=Profiles/abcd.default-release",
      "",
      "[General]",
      "StartWithLastProfile=1",
      "Version=2",
    ].join("\r\n");
    expect(firefoxProfilesFromIni(ini)).toEqual([
      { directory: "default", name: "default" },
      { directory: "default-release", name: "default-release" },
    ]);
  });

  it("skips a name that would be read as a flag after -P", () => {
    const ini = ["[Profile0]", "Name=-new-instance", "[Profile1]", "Name=work-2"].join("\n");
    expect(firefoxProfilesFromIni(ini)).toEqual([{ directory: "work-2", name: "work-2" }]);
  });
});

describe("launchEnvironment", () => {
  const env = { PATH: "/usr/bin", ELECTRON_RUN_AS_NODE: "1", CHROME_DESKTOP: "t3code.desktop" };

  it("never hands Electron's run-as-node switch to the browser", () => {
    expect(launchEnvironment(env, "win32")).toEqual({
      PATH: "/usr/bin",
      CHROME_DESKTOP: "t3code.desktop",
    });
  });

  it("drops T3 Code's desktop entry on Linux so the browser groups under its own", () => {
    expect(launchEnvironment(env, "linux")).toEqual({ PATH: "/usr/bin" });
  });
});

type LaunchableBrowser = Pick<DetectedSystemBrowser, "family" | "executable">;

const edge: LaunchableBrowser = {
  family: "chromium",
  executable: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
};

describe("buildLaunch", () => {
  it("passes the profile directory to Chromium browsers", () => {
    expect(
      buildLaunch(edge, { directory: "Profile 3", name: "Work" }, "https://example.com/", "win32"),
    ).toEqual({
      command: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
      args: ["--profile-directory=Profile 3", "https://example.com/"],
    });
  });

  it("goes through open on macOS so the running app receives the link", () => {
    const chrome: LaunchableBrowser = {
      family: "chromium",
      executable: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    };
    const profile = { directory: "Default", name: "Alice" };
    expect(buildLaunch(chrome, profile, "https://example.com/", "darwin")).toEqual({
      command: "open",
      args: [
        "-na",
        "/Applications/Google Chrome.app",
        "--args",
        "--profile-directory=Default",
        "https://example.com/",
      ],
    });
  });

  it("runs Chromium on Linux directly", () => {
    const chromium: LaunchableBrowser = { family: "chromium", executable: "/usr/bin/chromium" };
    expect(
      buildLaunch(chromium, { directory: "Default", name: "Me" }, "https://example.com/", "linux"),
    ).toEqual({
      command: "/usr/bin/chromium",
      args: ["--profile-directory=Default", "https://example.com/"],
    });
  });

  it.each(["win32", "darwin", "linux"] as const)(
    "selects a Firefox profile by name on %s",
    (platform) => {
      const firefox: LaunchableBrowser = { family: "firefox", executable: "/opt/firefox/firefox" };
      const profile = { directory: "work", name: "work" };
      expect(buildLaunch(firefox, profile, "https://example.com/", platform)).toEqual({
        command: "/opt/firefox/firefox",
        args: ["-P", "work", "-new-tab", "https://example.com/"],
      });
    },
  );
});
