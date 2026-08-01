import { describe, expect, test } from "vitest";
import { DEFAULT_SEARCH_URL, resolveAddressInput } from "./address";

describe("resolveAddressInput", () => {
  test("returns empty string for blank input", () => {
    expect(resolveAddressInput("")).toBe("");
    expect(resolveAddressInput("   ")).toBe("");
  });

  test("keeps existing http(s) URLs unchanged", () => {
    expect(resolveAddressInput("https://example.com/path?q=1")).toBe(
      "https://example.com/path?q=1",
    );
    expect(resolveAddressInput("http://example.com")).toBe("http://example.com");
    expect(resolveAddressInput("  https://example.com  ")).toBe("https://example.com");
  });

  test("keeps other known protocols unchanged", () => {
    expect(resolveAddressInput("mailto:hello@example.com")).toBe("mailto:hello@example.com");
  });

  test("prepends https:// to bare domains", () => {
    expect(resolveAddressInput("example.com")).toBe("https://example.com");
    expect(resolveAddressInput("www.example.com/path")).toBe("https://www.example.com/path");
    expect(resolveAddressInput("sub.example.com.cn")).toBe("https://sub.example.com.cn");
  });

  test("routes search queries to the default search engine", () => {
    expect(resolveAddressInput("花笺 笔记")).toBe(
      `${DEFAULT_SEARCH_URL}?q=${encodeURIComponent("花笺 笔记")}`,
    );
    expect(resolveAddressInput("hello world")).toBe(
      `${DEFAULT_SEARCH_URL}?q=${encodeURIComponent("hello world")}`,
    );
    // 单词无点 → 搜索
    expect(resolveAddressInput("flowers")).toBe(
      `${DEFAULT_SEARCH_URL}?q=${encodeURIComponent("flowers")}`,
    );
  });
});
