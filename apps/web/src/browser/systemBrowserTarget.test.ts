import { EnvironmentId, type SystemBrowser } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  findSystemBrowserTargetOption,
  removedEnvironmentSystemTargets,
  systemBrowserTargetLabel,
  systemBrowserTargetOptions,
  withEnvironmentSystemTarget,
} from "./systemBrowserTarget";

const edge: SystemBrowser = {
  id: "msedge",
  name: "Microsoft Edge",
  family: "chromium",
  profiles: [
    { directory: "Default", name: "Profile 1" },
    { directory: "Profile 3", name: "Work" },
  ],
};
const edgeWork = {
  browserId: "msedge",
  browserName: "Microsoft Edge",
  profileDirectory: "Profile 3",
  profileName: "Work",
};
const edgePersonal = { ...edgeWork, profileDirectory: "Profile 4", profileName: "Personal" };

describe("systemBrowserTargetLabel", () => {
  it("names the browser and profile", () => {
    expect(systemBrowserTargetLabel([edge], edgeWork)).toBe("Microsoft Edge · Work");
  });

  it("prefers the detected names over the ones saved with the choice", () => {
    expect(systemBrowserTargetLabel([edge], { ...edgeWork, profileName: "Old name" })).toBe(
      "Microsoft Edge · Work",
    );
  });

  it("flags a saved choice that is no longer detected by its saved names", () => {
    expect(systemBrowserTargetLabel([edge], edgePersonal)).toBe(
      "Microsoft Edge · Personal (not found)",
    );
  });

  it("does not flag a saved choice while the first scan is running", () => {
    expect(systemBrowserTargetLabel(null, edgePersonal)).toBe("Microsoft Edge · Personal");
  });

  it("falls back to the ids for a choice saved without display names", () => {
    const unnamed = { browserId: "msedge", profileDirectory: "Profile 4" };
    expect(systemBrowserTargetLabel([edge], unnamed)).toBe("msedge · Profile 4 (not found)");
    expect(systemBrowserTargetLabel([edge], { ...unnamed, profileDirectory: "Profile 3" })).toBe(
      "Microsoft Edge · Work",
    );
  });
});

describe("systemBrowserTargetOptions", () => {
  it("offers every detected profile and records its names when picked", () => {
    const options = systemBrowserTargetOptions([edge], []);
    expect(options.groups).toEqual([
      {
        browserId: "msedge",
        browserName: "Microsoft Edge",
        options: [
          expect.objectContaining({ label: "Profile 1" }),
          expect.objectContaining({ label: "Work" }),
        ],
      },
    ]);
    expect(options.missing).toEqual([]);
    expect(findSystemBrowserTargetOption(options, options.groups[0]!.options[1]!.value)).toEqual(
      edgeWork,
    );
  });

  it("keeps a saved choice that is gone selectable, once, so it stays visible", () => {
    const options = systemBrowserTargetOptions([edge], [edgePersonal, edgePersonal, edgeWork]);
    expect(options.missing.map((option) => option.label)).toEqual([
      "Microsoft Edge · Personal (not found)",
    ]);
    expect(findSystemBrowserTargetOption(options, options.missing[0]!.value)).toEqual(edgePersonal);
  });

  it("does not resolve a value no option has", () => {
    expect(findSystemBrowserTargetOption(systemBrowserTargetOptions([edge], []), "default")).toBe(
      null,
    );
  });
});

describe("per-environment choices", () => {
  const work = EnvironmentId.make("environment-work");
  const home = EnvironmentId.make("environment-home");
  const chrome = {
    browserId: "chrome",
    browserName: "Google Chrome",
    profileDirectory: "Default",
    profileName: "Alice",
  };

  it("sets and replaces one environment's choice without touching others", () => {
    const current = { [home]: chrome };
    expect(withEnvironmentSystemTarget(current, work, edgeWork)).toEqual({
      [home]: chrome,
      [work]: edgeWork,
    });
    expect(withEnvironmentSystemTarget({ [work]: chrome }, work, edgeWork)).toEqual({
      [work]: edgeWork,
    });
  });

  it("removes the entry when the environment goes back to the global choice", () => {
    expect(withEnvironmentSystemTarget({ [home]: chrome, [work]: edgeWork }, work, null)).toEqual({
      [home]: chrome,
    });
  });

  it("lists choices for environments that are no longer connected", () => {
    expect(removedEnvironmentSystemTargets({ [home]: chrome, [work]: edgeWork }, [home])).toEqual([
      [work, edgeWork],
    ]);
  });
});
