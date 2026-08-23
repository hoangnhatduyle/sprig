import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppPanel } from "./AppPanel";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("AppPanel", () => {
  beforeEach(() => {
    vi.stubGlobal("location", { ...window.location, reload: vi.fn() });
  });

  it("shows a message instead of checking when the browser has no service worker support", async () => {
    Object.defineProperty(navigator, "serviceWorker", { value: undefined, configurable: true });
    render(<AppPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Check" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Updates aren't available in this browser.");
  });

  it("calls registration.update() and reloads when checking for updates", async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "serviceWorker", {
      value: { getRegistration: vi.fn().mockResolvedValue({ update }) },
      configurable: true,
    });
    render(<AppPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Check" }));
    await vi.waitFor(() => expect(update).toHaveBeenCalled());
    expect(window.location.reload).toHaveBeenCalled();
  });

  it("requires confirmation before unregistering service workers and clearing caches", async () => {
    const unregister = vi.fn().mockResolvedValue(true);
    Object.defineProperty(navigator, "serviceWorker", {
      value: { getRegistrations: vi.fn().mockResolvedValue([{ unregister }]) },
      configurable: true,
    });
    const del = vi.fn().mockResolvedValue(true);
    vi.stubGlobal("caches", { keys: vi.fn().mockResolvedValue(["v1"]), delete: del });

    render(<AppPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(unregister).not.toHaveBeenCalled();

    const dialog = await screen.findByRole("dialog", { name: "Refresh and empty cache?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Refresh" }));

    await vi.waitFor(() => expect(unregister).toHaveBeenCalled());
    expect(del).toHaveBeenCalledWith("v1");
    expect(window.location.reload).toHaveBeenCalled();
  });
});
