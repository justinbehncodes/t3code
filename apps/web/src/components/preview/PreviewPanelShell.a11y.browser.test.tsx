import { act, render, type Screen } from "../../../test/render";
import { Dialog } from "@base-ui/react/dialog";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { PanelLayoutControls } from "../chat/PanelLayoutControls";
import { PreviewPanelShell, type PreviewPanelMode } from "./PreviewPanelShell";

async function renderPanel(
  screen: Screen,
  open: boolean | undefined,
  mode: PreviewPanelMode = "inline",
  present = true,
) {
  await screen.rerender(
    <Dialog.Root open>
      <Dialog.Portal>
        <Dialog.Popup aria-label="Workspace" finalFocus={false}>
          {present ? (
            <PreviewPanelShell mode={mode} {...(open === undefined ? {} : { open })}>
              <input aria-label="Preview URL" />
              <button type="button">Reload preview</button>
            </PreviewPanelShell>
          ) : null}
          <button type="button" data-testid="outside">
            Send message
          </button>
          <div key={present ? "root-controls" : "header-controls"}>
            <PanelLayoutControls
              showTerminalControl={false}
              showThreadPanelControl={false}
              terminalAvailable={false}
              terminalOpen={false}
              terminalShortcutLabel={null}
              threadPanelOpen={false}
              threadPanelPresentation="inline"
              threadPanelShortcutLabel={null}
              rightPanelAvailable
              rightPanelOpen={open ?? true}
              rightPanelShortcutLabel={null}
              onToggleTerminal={() => {}}
              onToggleThreadPanel={() => {}}
              onToggleRightPanel={() => {}}
            />
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>,
  );
  // The dialog moves initial focus into itself after mounting; later focus moves must not race it.
  await vi.waitFor(() =>
    expect(
      document.querySelector('[aria-label="Workspace"]')?.contains(document.activeElement),
    ).toBe(true),
  );
}

const expectFocused = (target: Element | string | null) =>
  vi.waitFor(() =>
    expect(document.activeElement).toBe(
      typeof target === "string" ? document.querySelector(target) : target,
    ),
  );

// Tabbing past the popup's last control wraps through Base UI's focus guard
// to the first tabbable descendant, which skips anything inert.
async function enterFocusScope() {
  const toggle = document.querySelector<HTMLElement>('[aria-label="Toggle right panel"]')!;
  await act(async () => toggle.focus());
  await userEvent.tab();
}

describe("right panel keyboard access", () => {
  it("skips collapsed controls and restores access after reopening", async () => {
    await using screen = await render(null);
    await renderPanel(screen, false);
    const outside = document.querySelector<HTMLElement>('[data-testid="outside"]')!;
    await expectFocused(outside);
    await enterFocusScope();
    await expectFocused(outside);

    await renderPanel(screen, true);
    await enterFocusScope();
    await expectFocused('[aria-label="Preview URL"]');

    await renderPanel(screen, false);
    await enterFocusScope();
    await expectFocused(outside);
  });

  it("returns focus to the right-panel toggle when a focused panel closes", async () => {
    await using screen = await render(null);
    await renderPanel(screen, true);
    const input = document.querySelector<HTMLInputElement>('[aria-label="Preview URL"]')!;
    await act(async () => input.focus());
    await renderPanel(screen, false);
    await expectFocused('[aria-label="Toggle right panel"]');
    await renderPanel(screen, true);
    await enterFocusScope();
    await expectFocused(input);
  });

  it("retains focus after the closing animation relocates the toggle", async () => {
    await using screen = await render(null);
    await renderPanel(screen, true);
    await act(async () => {
      document.querySelector<HTMLInputElement>('[aria-label="Preview URL"]')!.focus();
    });
    await renderPanel(screen, false);
    const closingToggle = document.querySelector('[aria-label="Toggle right panel"]');
    await expectFocused(closingToggle);
    await renderPanel(screen, false, "inline", false);
    const settledToggle = document.querySelector('[aria-label="Toggle right panel"]');
    expect(settledToggle).not.toBe(closingToggle);
    await expectFocused(settledToggle);
  });

  it("returns focus when the panel closes without an animation", async () => {
    await using screen = await render(null);
    await renderPanel(screen, true);
    await act(async () => {
      document.querySelector<HTMLInputElement>('[aria-label="Preview URL"]')!.focus();
    });
    await renderPanel(screen, false, "inline", false);
    await expectFocused('[aria-label="Toggle right panel"]');
  });

  it("preserves focus moved outside while the closing animation settles", async () => {
    await using screen = await render(null);
    await renderPanel(screen, true);
    await act(async () => {
      document.querySelector<HTMLInputElement>('[aria-label="Preview URL"]')!.focus();
    });
    await renderPanel(screen, false);
    const outside = document.querySelector<HTMLButtonElement>('[data-testid="outside"]')!;
    await act(async () => outside.focus());
    await renderPanel(screen, false, "inline", false);
    await expectFocused(outside);
  });

  it("preserves focus outside the panel when it closes", async () => {
    await using screen = await render(null);
    await renderPanel(screen, true);
    const outside = document.querySelector<HTMLButtonElement>('[data-testid="outside"]')!;
    await act(async () => outside.focus());
    await renderPanel(screen, false);
    await expectFocused(outside);
  });

  it.each(["sheet", "sidebar", "embedded"] as const)(
    "keeps %s controls reachable when the inline open flag is false",
    async (mode) => {
      await using screen = await render(null);
      await renderPanel(screen, false, mode);
      await expectFocused('[aria-label="Preview URL"]');
    },
  );

  it("keeps non-collapsible inline controls reachable", async () => {
    await using screen = await render(null);
    await renderPanel(screen, undefined);
    await expectFocused('[aria-label="Preview URL"]');
  });
});
