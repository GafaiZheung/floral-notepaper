# 浏览器侧栏功能手动测试报告

## 1. 测试概况

- 测试日期：2026-08-01（Asia/Shanghai）
- 测试对象：`Docs/superpowers/plans/2026-07-31-browser-sidebar-plan.md` 及对应实现
- 设计依据：`Docs/superpowers/specs/2026-07-31-browser-sidebar-design.md`
- 测试平台：macOS（当前 Codex 桌面环境）
- 测试方式：尝试启动 Tauri 桌面应用并使用 Computer Use；同时运行计划中的前端/Rust 自动化验证作为补充证据
- 代码修复：未进行。本报告文件是本次唯一新增的测试产物；工作区已有改动保持原样。

## 2. 启动记录

### 2.1 Tauri 开发应用

执行：

```text
pnpm tauri dev
```

结果：

- Vite 开发服务启动成功：`http://localhost:1420/`。
- Rust 后端编译成功，`target/debug/floral-notepaper` 进程启动成功。
- 编译有 5 条 warning（未使用导入、未使用 `ZOOM_STEP`、既有未使用函数等），没有编译错误。
- 该裸调试二进制没有被 Computer Use 的 macOS 应用列表注册为可操作的 `com.floral-notepaper.app` 桌面窗口；读取状态时多次超时，无法获得可点击控件树。

### 2.2 普通 Vite 页面（仅用于排除测试面误差）

曾将 `http://127.0.0.1:1420/` 加载到浏览器。页面不是有效的 Tauri 运行时，出现：

- `getCurrentWindow().isMaximized()` 访问 `metadata` 失败；
- `@tauri-apps/api/event` 的 `transformCallback` 失败；
- `MainWindow` 错误边界告警。

因此该页面不作为功能通过/失败依据，只记录为“不能用普通浏览器替代 Tauri 应用”的环境证据。

### 2.3 当前工作区 `.app` 构建尝试

执行：

```text
pnpm tauri build
```

结果：两次均在 Rust release 依赖编译阶段失败，未生成可供 Computer Use 连接的当前版本 `.app`：

1. 首次失败：`can't find crate for ctor_proc_macro`。
2. 重试失败：`darling_macro` 动态库加载错误（`mis-aligned LINKEDIT string pool`）。

前端生产构建阶段成功；另有字体路径未解析和大 chunk 体积提示。上述属于本机 Rust 增量编译/二进制缓存环境问题，未修改代码处理。

## 3. Computer Use 操作结果

Computer Use 可以读取 Safari 和已安装花笺应用的可访问性树/截图，但所有会改变桌面 UI 状态的操作均被环境拒绝：

```text
Computer Use was not approved to use Safari
Computer Use was not approved to use 花笺
```

已安装的 `/Applications/花笺.app` 可以被读取到窗口标题“花笺”，但截图为全黑/空白窗口，且点击、键盘操作同样被拒绝；它也不是当前工作区构建产物，因此不用于判定当前代码功能。

结论：本次环境没有提供可执行的 Computer Use GUI 操作权限，且当前工作区 `.app` 构建未完成，无法对真实 Tauri 窗口执行有效的点击、输入、拖拽或快捷键验收。未将普通浏览器 DOM 操作冒充为 Tauri 手动测试。

## 4. 计划手动验收矩阵

状态含义：`阻塞` = 测试步骤已定义但因环境原因未能执行；不是对功能实现本身的通过或失败判定。

| 编号 | 验收项                                          | 结果 | 阻塞/证据                                            |
| ---- | ----------------------------------------------- | ---- | ---------------------------------------------------- |
| M-01 | 笔记中的 http(s) 链接自动展开浏览区并停靠子窗口 | 阻塞 | 无法操作 Tauri 主窗口；Computer Use GUI 操作未获批准 |
| M-02 | 多标签切换与关闭；关闭全部自动收回              | 阻塞 | 无法点击浏览器图标、标签、关闭按钮                   |
| M-03 | 真实站点前进/后退/刷新                          | 阻塞 | 无法输入地址或点击工具栏                             |
| M-04 | `target="_blank"` / `window.open` 不弹新窗      | 阻塞 | 无法打开真实停靠 WebView；未对外部站点做替代性测试   |
| M-05 | 主窗口拖动/缩放时子窗口跟随；多显示器拖动       | 阻塞 | 无法进行桌面拖拽/窗口调整                            |
| M-06 | 收回/重开保留标签                               | 阻塞 | 无法操作“收回”或重新展开                             |
| M-07 | 浮窗摘出/置顶/重新停靠                          | 阻塞 | 无法打开更多菜单或操作系统窗口状态                   |
| M-08 | Ctrl/Cmd+W 关闭活跃标签                         | 阻塞 | 无法发送键盘快捷键                                   |
| M-09 | Ctrl/Cmd+Tab 与 Ctrl/Cmd+Shift+Tab 切换标签     | 阻塞 | 无法发送键盘快捷键                                   |
| M-10 | Ctrl/Cmd+L 聚焦地址栏；Esc 失焦                 | 阻塞 | 无法发送键盘快捷键或读取焦点变化                     |
| M-11 | A−/A+ 缩放即时生效                              | 阻塞 | 无法点击缩放按钮；无真实 WebView 内容                |
| M-12 | 存为笔记生成正确内容                            | 阻塞 | 无法打开菜单、触发保存或验证新笔记                   |
| M-13 | 重启后标签清空                                  | 阻塞 | 无法完成一轮可控的打开/关闭/重启                     |
| M-14 | 主窗口最小化/托盘隐藏恢复后子窗口状态一致       | 阻塞 | 无法执行系统窗口操作                                 |

## 5. 自动化补充验证

### 5.1 前端

执行：

```text
pnpm test
pnpm lint
pnpm exec tsc --noEmit
```

结果：

- `pnpm test`：34 个测试文件通过，177/177 tests 通过。
- `pnpm lint`：退出码 0；有 15 条既有风格 warning，主要是正则可改为 `startsWith` 和不必要转义，不影响执行。
- `pnpm exec tsc --noEmit`：通过，无输出错误。

这覆盖了地址解析、BrowserPanel 静态/交互映射、MarkdownPreview 外部链接回调、浏览器类型/API、既有编辑器及主窗口测试等代码级行为，但不等价于桌面 WebView 手动验收。

### 5.2 Rust

执行：

```text
cargo test --manifest-path src-tauri/Cargo.toml
```

结果：187 个测试中 183 通过，4 个失败：

- `updater::download::tests::cancels_download_and_cleans_partial_file`：测试服务器 bind 被环境拒绝（`Operation not permitted`）。
- `updater::download::tests::deletes_partial_file_on_hash_mismatch`：同上。
- `updater::download::tests::downloads_asset_and_emits_progress`：同上。
- `services::notes::tests::creates_updates_reads_and_deletes_markdown_notes`：移入回收站依赖 Finder/AppleScript，被环境拒绝（`Connection invalid` / `Cannot get application Finder`）。

计划新增/涉及浏览器逻辑的 Rust 单测全部通过，包括：停靠矩形缩放、历史栈边界与去重、zoom 钳制、URL 规范化、标签注册表增删/激活/移除及 hostname 标题回退。

## 6. 测试结论

1. 当前工作区的前端测试、TypeScript 检查和浏览器相关 Rust 单测均通过。
2. 完整 Rust 测试集有 4 个环境权限失败，不是浏览器侧栏测试失败；需在允许本地监听和 Finder 自动化的环境重跑。
3. Tauri 开发进程能够启动，但 Computer Use 无法连接/操作裸调试窗口；当前工作区 `.app` 构建又被本机 Rust 缓存/动态库问题阻塞。
4. 因此本报告不对 M-01 至 M-14 给出“通过”或“失败”结论，统一标记为“阻塞/未执行”，避免把环境限制误判为产品行为。

## 7. 后续复测条件

在具备以下条件后，按第 4 节矩阵重新执行并补录截图/实际结果：

- 在 macOS“系统设置 → 隐私与安全性 → 辅助功能”中允许 Computer Use 控制目标 Tauri 应用；
- 能成功构建并打开当前工作区的 `com.floral-notepaper.app` `.app` 包，或提供可被 Computer Use 识别的开发窗口；
- 允许测试进程监听本地临时端口；
- 若要重跑完整 Rust 测试，允许测试服务器 bind 以及 Finder 回收站自动化。
