import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { WindowBounds } from "./api";

export type ResizeDirection = "NorthWest" | "NorthEast" | "SouthWest" | "SouthEast";

export async function showCurrentWindow(): Promise<void> {
  const window = getCurrentWindow();
  await window.show();
  await window.setFocus();
}

export function hideCurrentWindow(): Promise<void> {
  return getCurrentWindow().hide();
}

export function closeCurrentWindow(): Promise<void> {
  return getCurrentWindow().close();
}

export function recycleCurrentNotepad(): Promise<void> {
  return invoke("recycle_notepad_window", {
    label: getCurrentWindow().label,
  });
}

export function minimizeCurrentWindow(): Promise<void> {
  return getCurrentWindow().minimize();
}

export function toggleMaximizeCurrentWindow(): Promise<void> {
  return getCurrentWindow().toggleMaximize();
}

export function isCurrentWindowMaximized(): Promise<boolean> {
  return getCurrentWindow().isMaximized();
}

export function setCurrentWindowAlwaysOnTop(enabled: boolean): Promise<void> {
  return getCurrentWindow().setAlwaysOnTop(enabled);
}

export function startCurrentWindowDrag(): Promise<void> {
  return getCurrentWindow().startDragging();
}

/** Shift window by `(dx, dy)` logical px then start an OS drag, in one IPC. */
export function startCurrentWindowDragWithOffset(dx: number, dy: number): Promise<void> {
  return invoke("start_window_drag_with_offset", { dx, dy });
}

export function startCurrentWindowResize(direction: ResizeDirection = "SouthEast"): Promise<void> {
  return getCurrentWindow().startResizeDragging(direction);
}

export async function getCurrentWindowBounds(): Promise<WindowBounds> {
  const window = getCurrentWindow();
  const [position, size] = await Promise.all([window.outerPosition(), window.innerSize()]);

  return {
    x: position.x,
    y: position.y,
    width: size.width,
    height: size.height,
  };
}

/**
 * 窗口位移动画：单次 IPC 交给 Rust 侧线程按帧推进（~16ms 步进，ease-out），
 * 避免前端逐帧两次 IPC 往返导致掉帧。
 */
export function animateCurrentWindowBounds(target: WindowBounds, durationMs = 180): Promise<void> {
  return invoke("animate_window_bounds", { target, durationMs });
}
