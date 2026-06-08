import { describe, expect, test } from "vitest";
import { getNoteContextMenuItems } from "./noteContextMenu";

describe("getNoteContextMenuItems", () => {
  test("includes export, move, open file location, and delete actions", () => {
    expect(getNoteContextMenuItems()).toEqual([
      { action: "export", label: "导出 Markdown" },
      { action: "move", label: "移动到分类…" },
      { action: "openFileLocation", label: "打开文件位置" },
      { action: "delete", label: "删除笔记", tone: "danger" },
    ]);
  });
});
