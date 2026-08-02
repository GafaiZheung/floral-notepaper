import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { browserCloseAll, browserNewTab, browserSetVisible, browserSetWidth } from "./api";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);

describe("browser api", () => {
  beforeEach(() => mockedInvoke.mockReset());

  test("closes all tabs with one atomic command", async () => {
    mockedInvoke.mockResolvedValue({ tabs: [] });

    await browserCloseAll();

    expect(mockedInvoke).toHaveBeenCalledOnce();
    expect(mockedInvoke).toHaveBeenCalledWith("browser_close_all");
  });

  test("controls the external panel visibility and width", async () => {
    mockedInvoke.mockResolvedValue({ tabs: [] });

    await browserSetVisible(true);
    await browserSetWidth(520);

    expect(mockedInvoke).toHaveBeenNthCalledWith(1, "browser_set_visible", { visible: true });
    expect(mockedInvoke).toHaveBeenNthCalledWith(2, "browser_set_width", { width: 520 });
  });

  test("opens the native welcome-page tab state", async () => {
    mockedInvoke.mockResolvedValue({ tabs: [], activeTabId: null });

    await browserNewTab();

    expect(mockedInvoke).toHaveBeenCalledWith("browser_new_tab");
  });
});
