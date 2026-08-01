# 微信式侧边栏浏览器 — 设计文档

> **Spec:** 实现计划见 `docs/superpowers/plans/2026-07-31-browser-sidebar-plan.md`

**日期:** 2026-07-31

## 1. 背景与调研基准

微信 PC 4.1.8（2026-02 内测 / 2026-03 稳定版，Windows + macOS）新增「正在浏览窗口」：聊天窗口右侧扩展独立浏览区域，公众号文章、笔记、外部链接在右侧打开，界面由两列变三列；浏览区顶部有标题栏与"关闭/收回"快捷键。微信 3.9.5 起内置浏览器支持多标签页、拖标签摘出为多窗口、工具栏收纳进"···"（转发/收藏/刷新/浮窗/字号/复制网址）。微信 4.0 起为 QT + C++ 原生架构，Windows 内置浏览器/小程序用 Chromium。

本项目为 Tauri 2 应用（tauri 2.11 / wry 0.55 / tao 0.35），等价物是系统 WebView（WebView2 / WKWebView / WebKitGTK）。Tauri 官方讨论 #14273 确认：同窗口多 webview 仍为 unstable API，child webview 大概率不会到来 → 采用与项目现有 notepad/tile 多开机制同构的**停靠子窗口**方案。

## 2. 关键 API 事实（Tauri 2.11 实测核查）

| API                                                                         | 平台                                         | 用途                                                                 |
| --------------------------------------------------------------------------- | -------------------------------------------- | -------------------------------------------------------------------- |
| `WebviewWindowBuilder::on_new_window` → `NewWindowResponse::Deny`           | Win/macOS/Linux（不含移动端）                | 统一拦截 `window.open`/`target="_blank"`，Deny 后同窗 `navigate()`   |
| `on_document_title_changed`                                                 | 全平台                                       | 页面标题回写（取代 eval）                                            |
| `on_navigation` / `on_page_load` / `on_download`                            | 全平台                                       | URL 回写、历史栈、loading 态                                         |
| `WebviewUrl::External`                                                      | 全平台（仅 http/https）                      | 标签窗口加载外部网页                                                 |
| `WebviewWindow::set_zoom`                                                   | **仅 Windows**                               | 字号缩放；其余平台 `eval` 注入 `document.documentElement.style.zoom` |
| `set_decorations/set_always_on_top/set_resizable/set_skip_taskbar/set_size` | 全平台桌面（skip_taskbar 在 macOS 为 no-op） | 浮窗/停靠切换                                                        |
| `parent()`                                                                  | Win=owner / macOS=child / Linux=transient    | **不采用**：无运行时解除 API，浮窗模式会受约束                       |
| 同步命令建窗                                                                | Windows 死锁（wry#583）                      | 所有浏览器命令必须 async                                             |

## 3. 架构

```
主窗口 (main)
┌──────────────┬──────┬──────────────┬──────┬─────────────┐
│ LeftIcon     │ 左面板│ 编辑区        │ 分隔条│ BrowserPanel│
│ Sidebar      │      │              │      │ (标签/工具/… )│
└──────────────┴──────┴──────────────┴──────┴─────────────┘
                                              │ 视觉并排
                                    ┌─────────┴─────────┐
                                    │ browser-<uuid>     │ 停靠子窗口（无边框/无阴影/
                                    │ 系统 WebView 网页   │ skip_taskbar/不透明/不可调）
                                    └───────────────────┘
   pos = (main.x + main.width, main.y + 44px×scale)
   size = (dockWidth, main.height − 44px×scale)    // 44px = 前端 h-11 标题栏
```

- 数据流：Rust `BrowserRegistry` 为唯一数据源，任何变更 `emit("browser-state-changed", BrowserState)`；前端订阅该事件，`BrowserPanel` 为受控组件。
- 每标签一个 `browser-<uuid>` WebviewWindow；隐藏（收回/托盘隐藏）复用 Windows `set_webview_memory_usage_level(LOW)` 降内存。
- 浮窗：`set_decorations(true)` + `set_always_on_top(true)` + `set_resizable(true)` + `set_skip_taskbar(false)` + 360×520；停靠恢复即反向 + `sync_dock`。浮窗窗口不参与停靠同步。
- 新窗口：`on_new_window` 返回 `Deny`，随后对当前标签 `navigate(url)`。
- 标签行为：每次"打开链接"新建标签；活跃标签 URL 相同则激活；关闭全部自动收回；`+` 新标签显示空页态（不建窗直到输入网址）。
- 会话：不持久化（重启后标签清空），不新增 AppConfig 字段。

## 4. 命令接口（invoke）

`browser_get_state()` / `browser_open(url)` / `browser_activate(tabId)` / `browser_close(tabId)` / `browser_navigate(tabId, url)` / `browser_back(tabId)` / `browser_forward(tabId)` / `browser_reload(tabId)` / `browser_stop(tabId)` / `browser_set_zoom(tabId, zoom)` / `browser_toggle_float(tabId)` / `browser_set_width(width)` / `browser_set_visible(visible)`

全部返回最新 `BrowserState`；任何变更同步 emit `browser-state-changed`。窗口 `Destroyed`（含标签关闭、应用退出）时移除注册表并再发事件。

## 5. 前端组件

- `BrowserPanel`：`forwardRef` 暴露 `focusAddressBar()`；props `{ state }`；标签栏 + 工具栏（后退/前进/刷新/停止、地址兼搜索栏、A−/A+）+ "···"菜单（浮窗、系统打开、复制网址、存为笔记、收回、关闭全部）+ 空页态。
- 地址解析：无空格且形如域名（含点）→ 补 `https://`；其他（含空格/非 http(s) 协议）→ Bing 搜索（`https://www.bing.com/search?q=`）。
- `MarkdownPreview` 新增可选 `onExternalLink?: (href) => void`，缺省仍走 `openUrl`（插件 opener）；MainWindow 传入 `openBrowserTab`（仅笔记正文链接路由到侧边栏，应用内链接保持系统浏览器）。
- 快捷键（主窗口聚焦、浏览列展开时）：Ctrl+W 关当前标签、Ctrl+Tab/Ctrl+Shift+Tab 切换、Ctrl+L 聚焦地址栏、Esc 地址栏失焦。
- 存为笔记：`createNote({ title: 页面标题 || hostname, content: "# 标题\n\n[链接](url)\n\n> 来源：url" })`，成功 `showToast(info)`。

## 6. 平台细节

| 项         | Windows                          | macOS                                                     | Linux             |
| ---------- | -------------------------------- | --------------------------------------------------------- | ----------------- |
| 缩放       | `set_zoom`                       | CSS zoom 注入                                             | CSS zoom 注入     |
| 隐藏降内存 | `SetMemoryUsageTargetLevel(LOW)` | —                                                         | —                 |
| 任务栏     | 停靠隐藏/浮窗显示                | 无任务栏概念                                              | 停靠隐藏/浮窗显示 |
| 停靠层级   | Focused 时 `show()` 提升         | 同应用窗口层级（auxiliary collection behavior）           | 同应用窗口层级    |
| 主窗口全屏 | 随 Resized 同步                  | 随 Resized 同步（配合既有 `hide_fullscreen_window` 路径） | 随 Resized 同步   |

## 7. 测试策略

- Rust 单测：停靠矩形（逻辑/物理换算）、注册表增删/激活/浮窗、历史栈边界与去重、zoom 钳制、capability JSON 断言。
- 前端单测：地址解析、BrowserPanel 按钮→api 映射（mock api 模块）、MarkdownPreview 回调、i18n key 完整性。
- 手动验收见计划文档 Task 10 清单（Win/macOS/Linux 各一遍）。

## 8. 风险

- macOS WKWebView 对 `window.open` 的 Deny 行为需实机验证（退回注入脚本改写 `target="_blank"` 的备选方案）。
- Windows 停靠子窗口 z-order：主窗口 Focused 时 `show()` 提升；极端场景（其他应用置顶）可接受。
- 深浅色主题下子窗口背景取创建时应用纸色，不跟随实时切换（明确接受的简化）。
