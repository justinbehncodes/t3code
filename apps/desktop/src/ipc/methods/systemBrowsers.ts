import { SystemBrowser } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as SystemBrowsers from "../../browser/SystemBrowsers.ts";
import * as IpcChannels from "../channels.ts";
import * as DesktopIpc from "../DesktopIpc.ts";

export const listSystemBrowsers = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.LIST_SYSTEM_BROWSERS_CHANNEL,
  // `true` rescans instead of returning the cached detection.
  payload: Schema.Boolean,
  result: Schema.Array(SystemBrowser),
  handler: Effect.fn("desktop.ipc.systemBrowsers.list")(function* (refresh) {
    const systemBrowsers = yield* SystemBrowsers.SystemBrowsers;
    return yield* refresh ? systemBrowsers.refresh : systemBrowsers.list;
  }),
});
