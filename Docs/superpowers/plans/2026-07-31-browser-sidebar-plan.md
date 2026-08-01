# 微信式侧边栏浏览器 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在主窗口右侧新增“浏览器”侧边栏（对齐微信 4.1.8「正在浏览窗口」）：笔记正文里的 http(s) 链接在侧边栏打开，支持多标签、地址/搜索栏、前进/后退/刷新、字号缩放、复制网址、系统浏览器打开、浮窗（置顶小窗）与“存为笔记”。网页渲染采用停靠子窗口方案：每个标签页是一个无边框、不占任务栏的系统 WebView 子窗口，贴靠主窗口右缘并随主窗口移动/缩放同步。标签页不跨重启恢复。

**Architecture:** Tauri 2 同窗口多 webview 仍为 unstable API（tauri-apps/tauri 讨论 #14273），采用与现有 notepad/tile 多开机制同构的“停靠子窗口”方案。Rust 侧新增 `services/browser.rs`：`BrowserRegistry`（Mutex 状态：标签列表、每标签 URL 历史栈与游标、停靠宽度、可见性）+ 标签窗口 `browser-<uuid>`（`WebviewUrl::External`，无边框/无阴影/不占任务栏/不透明）。所有浏览器命令为 async（Windows 上同步命令建窗会死锁，wry#583）。新窗口拦截统一用 `WebviewWindowBuilder::on_new_window` → `Deny` → 当前标签 `navigate()`（跨平台）；页面标题用 `on_document_title_changed` 获取。停靠同步挂入 `desktop::handle_window_event` 的 `Moved`/`Resized`/`Focused` 分支。前端以 `browser-state-changed` 事件负载为唯一数据源。

**Tech Stack:** React 19 + TypeScript, Tauri 2.11 (Rust backend), Tailwind CSS, i18next

**Spec:** `docs/superpowers/specs/2026-07-31-browser-sidebar-design.md`

---

## File Structure

| 文件                                               | 职责                                                                                                                                                                             |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src-tauri/src/services/browser.rs`（新建）        | BrowserRegistry、标签窗口创建/销毁、历史栈、停靠矩形计算、zoom 钳制、命令实现、状态事件                                                                                          |
| `src-tauri/src/services/mod.rs`                    | 注册 `pub mod browser;`                                                                                                                                                          |
| `src-tauri/src/lib.rs`                             | `browser_*` async 命令薄封装 + invoke_handler 注册                                                                                                                               |
| `src-tauri/src/desktop.rs`                         | `handle_window_event` 增加 Moved/Resized/Focused/Destroyed(browser-\*) 分支；`set_webview_memory_usage_level`/`apply_macos_window_behavior` 改为 pub(crate)；capability 测试更新 |
| `src-tauri/capabilities/default.json`              | windows 增加 `"browser-*"`                                                                                                                                                       |
| `src/features/browser/types.ts`（新建）            | BrowserTab / BrowserState 类型                                                                                                                                                   |
| `src/features/browser/api.ts`（新建）              | `browser_*` 命令封装                                                                                                                                                             |
| `src/features/browser/events.ts`（新建）           | `browser-state-changed` 监听                                                                                                                                                     |
| `src/features/browser/address.ts`（新建）          | 地址输入解析（URL 补全 vs 搜索）                                                                                                                                                 |
| `src/components/BrowserPanel.tsx`（新建）          | 侧边栏浏览器面板（标签栏/工具栏/···菜单/空页态）                                                                                                                                 |
| `src/components/LeftIconSidebar.tsx`               | `SidebarPanel` 扩展 `"browser"` + 浏览器图标                                                                                                                                     |
| `src/components/MainWindow.tsx`                    | 布局列 + 拖拽分隔条 + 快捷键 + `onExternalLink` 回调 + 状态订阅                                                                                                                  |
| `src/features/markdown/MarkdownPreview.tsx`        | 增加可选 `onExternalLink?` prop                                                                                                                                                  |
| `src/locales/{zh-CN,en-US,zh-HK}/translation.json` | `browser.*`、`main.sidebar.tabBrowser` 文案                                                                                                                                      |

---

### Task 1: Rust — BrowserRegistry 与历史栈（纯逻辑）

**Files:**

- Create: `src-tauri/src/services/browser.rs`

- [ ] **Step 1: 定义数据结构**

```rust
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserTab { pub tab_id: String, pub url: String, pub title: String,
  pub zoom: f64, pub floating: bool, pub active: bool,
  pub can_go_back: bool, pub can_go_forward: bool, pub loading: bool }
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserState { pub tabs: Vec<BrowserTab>, pub active_tab_id: Option<String>,
  pub dock_width: f64, pub visible: bool }
```

- [ ] **Step 2: HistoryStack**：`entries: Vec<String>` + `cursor: usize`；`push`（去重连续相同 URL，截断 cursor 之后）、`back/forward`（边界返回 None）、`can_go_back/can_go_forward`。
- [ ] **Step 3: BrowserRegistry（Mutex 状态）**：`tabs: Mutex<Vec<BrowserEntry>>`（`{tab_id,url,title,zoom,floating}`）、`histories: Mutex<HashMap<String, HistoryStack>>`、`dock_width: Mutex<f64>`（默认 420）、`visible: Mutex<bool>`。方法：`state()` 构建 BrowserState、`upsert_tab`、`remove_tab`（连带历史）、`find_active`、`set_dock_width`（钳制 300..=主窗口 60%）、`set_visible`。
- [ ] **Step 4: 常量**：`BROWSER_EVENT = "browser-state-changed"`、`TITLEBAR_HEIGHT = 44.0`（对齐前端 h-11 标题栏）、`DEFAULT_DOCK_WIDTH = 420.0`、`MIN_DOCK_WIDTH = 300.0`、`FLOAT_WIDTH = 360.0`、`FLOAT_HEIGHT = 520.0`、`MIN_ZOOM = 0.5`、`MAX_ZOOM = 2.0`、`ZOOM_STEP = 0.1`。

### Task 2: Rust — 标签窗口与命令

**Files:**

- Edit: `src-tauri/src/services/browser.rs`

- [ ] **Step 1: `open(app, url)`**：URL 校验（仅 http/https）；若活跃标签 URL 相同则激活；否则新建 `BrowserTab`（tabId = `browser-{Uuid}`）+ `WebviewWindowBuilder`（`WebviewUrl::External`，`decorations(false)`、`shadow(false)`、`skip_taskbar(true)`、`transparent(false)`、`resizable(false)`、`visible(false)`、`background_color` 纸色）注册 `on_new_window`（Deny + 同窗 navigate）、`on_document_title_changed`（写回标题 + emit）、`on_navigation`（去重写回 URL + 历史 + emit）、`on_page_load`（loading 态 + emit）；`apply_macos_window_behavior(auxiliary=true)`；`sync_dock` + show + focus；emit 状态。
- [ ] **Step 2: `activate` / `close` / `navigate` / `back` / `forward` / `reload` / `stop`**：操作对应窗口；back/forward 从历史栈取 URL 后 navigate。
- [ ] **Step 3: `set_zoom`**：钳制 0.5–2.0 步进 0.1；Windows 用 `window.set_zoom`，其余平台 `eval("document.documentElement.style.zoom = ...")`。
- [ ] **Step 4: `toggle_float`**：浮窗 = `set_decorations(true)` + `set_always_on_top(true)` + `set_resizable(true)` + `set_skip_taskbar(false)` + `set_size(360×520)`；停靠恢复 = 还原四项 + `sync_dock`。
- [ ] **Step 5: `set_width` / `set_visible`**：宽度钳制并重排；隐藏时 `hide` + Windows `set_webview_memory_usage_level(low)`，显示时还原 + `sync_dock` + focus。
- [ ] **Step 6: `get_state`**；**`handle_window_destroyed(app, label)`**：从注册表移除标签并 emit。
- [ ] **Step 7: `sync_dock(app)`**：主窗口 `outer_position` + `inner_size` + `scale_factor`；子窗口 pos = (main.x + main.width, main.y + TITLEBAR_HEIGHT×scale)，size = (dock_width×scale, main.height − TITLEBAR_HEIGHT×scale)；浮窗标签跳过。

### Task 3: Rust — 窗口事件集成与注册

**Files:**

- Edit: `src-tauri/src/desktop.rs`, `src-tauri/src/lib.rs`, `src-tauri/capabilities/default.json`, `src-tauri/src/services/mod.rs`

- [ ] **Step 1: desktop.rs**：`set_webview_memory_usage_level` 与 `apply_macos_window_behavior` 改 `pub(crate)`；`handle_window_event` 增加：`Destroyed` 且 `browser-*` → `browser::handle_window_destroyed`；主窗口 `Moved`/`Resized`/`Focused` → `browser::sync_dock`（Focused 时 Windows 下对可见停靠子窗口 `show()` 提升层级）。
- [ ] **Step 2: services/mod.rs** `pub mod browser;`。
- [ ] **Step 3: lib.rs**：新增 `browser_get_state`、`browser_open`、`browser_activate`、`browser_close`、`browser_navigate`、`browser_back`、`browser_forward`、`browser_reload`、`browser_stop`、`browser_set_zoom`、`browser_toggle_float`、`browser_set_width`、`browser_set_visible`（均为 async，调 `services::browser::*`），注册进 `generate_handler!`。
- [ ] **Step 4: capabilities/default.json** windows 增加 `"browser-*"`；更新 desktop.rs 底部 capability 测试断言。

### Task 4: Rust 单测

**Files:**

- Edit: `src-tauri/src/services/browser.rs`

- [ ] **Step 1: 停靠矩形计算**（含缩放后的逻辑/物理坐标换算，纯函数化测试）。
- [ ] **Step 2: 注册表增删/激活/浮窗切换/宽度钳制**。
- [ ] **Step 3: 历史栈回退/前进边界与去重**。
- [ ] **Step 4: zoom 钳制与标签名清洗**。

### Task 5: 前端 — features/browser

**Files:**

- Create: `src/features/browser/types.ts`, `api.ts`, `events.ts`, `address.ts`

- [ ] **Step 1: types.ts**：`BrowserTab`/`BrowserState`（camelCase 对齐 Rust）。
- [ ] **Step 2: api.ts**：`browserGetState/browserOpen/browserActivate/browserClose/browserNavigate/browserBack/browserForward/browserReload/browserStop/browserSetZoom/browserToggleFloat/browserSetWidth/browserSetVisible`。
- [ ] **Step 3: events.ts**：`subscribeBrowserState(cb): Promise<UnlistenFn>`。
- [ ] **Step 4: address.ts**：`resolveAddressInput`（带空格/非 http(s) 协议 → 搜索 Bing；无空格含点 → 补 `https://`；否则搜索）；导出 `DEFAULT_SEARCH_URL` 常量。

### Task 6: 前端 — BrowserPanel

**Files:**

- Create: `src/components/BrowserPanel.tsx`

- [ ] **Step 1: 组件签名**：`forwardRef` 暴露 `focusAddressBar()`；props `{ state: BrowserState }`；内部自调用 api + `showToast` + `createNote` + `openUrl`。
- [ ] **Step 2: 标签栏**：标签标题（页面标题，空则 hostname）、关闭 ×、+ 新标签（空页态：居中搜索框，不建窗）、当前标签浮窗开关、右侧“···”菜单（浮窗开关/系统浏览器打开/复制网址/存为笔记/收回/关闭全部）。
- [ ] **Step 3: 工具栏**：后退/前进/刷新/停止（随 `canGoBack/canGoForward/loading` 禁用态）、地址兼搜索栏（Enter 提交 → `resolveAddressInput` → 活跃标签 navigate 或 open）、A−/A+。
- [ ] **Step 4: 空页态**：`state.tabs` 为空时居中搜索框；提交 → `browserOpen`。
- [ ] **Step 5: 存为笔记**：`createNote({ title: tab.title || hostname, content: "# 标题\n\n[链接](url)\n\n> 来源：url" })` → `showToast(browser.toast.noteSaved, "info")`。

### Task 7: 前端 — MainWindow 集成

**Files:**

- Edit: `src/components/MainWindow.tsx`, `src/components/LeftIconSidebar.tsx`, `src/features/markdown/MarkdownPreview.tsx`

- [ ] **Step 1: LeftIconSidebar**：`SidebarPanel` 扩展 `"browser"`；新增浏览器图标（地球 SVG，title `main.sidebar.tabBrowser`）。
- [ ] **Step 2: MainWindow 状态**：`browserState`（订阅 `subscribeBrowserState` + 初始 `browserGetState`）；`sidebarTab` 类型扩展；`handleSidebarSelect(panel)`：点击 browser 展开（已展开则收回），切其他面板收回浏览列。
- [ ] **Step 3: 布局**：编辑区列之后插入分隔条（仿侧栏拖拽，宽度钳制 300..60% 主窗口）与 `BrowserPanel` 列（`shrink-0`，宽度来自 `browserState.dockWidth` / 拖拽本地值）；懒加载 `lazy(() => import("./BrowserPanel"))` + Suspense。
- [ ] **Step 4: MarkdownPreview**：`onExternalLink?: (href: string) => void`；`a` 组件 onClick 优先调用它，默认仍 `openUrl`。
- [ ] **Step 5: 链接路由**：MainWindow 传 `onExternalLink={openBrowserTab}`：`setSidebarTab("browser")` + `browserOpen(url)`。
- [ ] **Step 6: 快捷键**（仅 browser 模式）：Ctrl+W 关活跃标签、Ctrl+Tab/Ctrl+Shift+Tab 切换、Ctrl+L 聚焦地址栏（`browserPanelRef`）、Esc 由 BrowserPanel 自处理（地址栏失焦）。
- [ ] **Step 7: 收回联动**：切到非 browser 面板时 `browserSetVisible(false)`。

### Task 8: i18n

**Files:**

- Edit: `src/locales/zh-CN/translation.json`, `src/locales/en-US/translation.json`, `src/locales/zh-HK/translation.json`

- [ ] **Step 1: zh-CN 新增** `browser.*`（tabNew/toolbar.back/forward/reload/stop/addressPlaceholder/zoomIn/zoomOut/menu.floating/unfloat/openInSystem/copyUrl/saveAsNote/retract/closeAll/emptyTitle/emptyHint/toast.noteSaved/toast.urlCopied）+ `main.sidebar.tabBrowser`。
- [ ] **Step 2: en-US / zh-HK 覆盖**（resources.ts 浅合并机制，只加覆盖键）。

### Task 9: 前端单测

**Files:**

- Create: `src/features/browser/address.test.ts`, `src/components/BrowserPanel.test.tsx`；Edit: `src/features/markdown/MarkdownPreview.test.tsx`

- [ ] **Step 1: address.test.ts**：URL 补全 vs 搜索、空白输入、协议保留、中文搜索词。
- [ ] **Step 2: BrowserPanel.test.tsx**：`renderToStaticMarkup` 渲染标签栏/工具栏/空页态；按钮调用对应 api（`vi.mock` api 模块）。
- [ ] **Step 3: MarkdownPreview.test.tsx**：有 `onExternalLink` 时点击调用回调而非 `openUrl`。

### Task 10: 全量验证

- [ ] **Step 1:** `cargo check` + `cargo test`（src-tauri）。
- [ ] **Step 2:** `npm test` + `npm run lint` + `npx tsc --noEmit`。

---

## 手动验收（Win/macOS/Linux 各一遍）

- [ ] 笔记点链接自动展开浏览区并停靠子窗口
- [ ] 多标签切换与关闭；关闭全部自动收回
- [ ] 真实站点前进/后退/刷新；`target="_blank"`/`window.open` 不弹新窗
- [ ] 主窗口拖动/缩放子窗口跟随无跳变；多显示器拖动
- [ ] 收回/重开保留标签；浮窗摘出/置顶/重新停靠
- [ ] Ctrl+W / Ctrl+Tab / Ctrl+L；字号缩放即时生效
- [ ] 存为笔记生成正确内容；重启后标签清空
- [ ] 主窗口最小化/托盘隐藏恢复后子窗口状态一致
