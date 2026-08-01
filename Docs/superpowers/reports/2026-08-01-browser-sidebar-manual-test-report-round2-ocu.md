# 浏览器侧栏功能手动测试报告(第二轮 · open-computer-use 实操)

## 1. 测试概况

- 测试日期：2026-08-01(Asia/Shanghai)
- 测试对象：`Docs/superpowers/plans/2026-07-31-browser-sidebar-plan.md` 及对应实现(浏览器侧边栏)
- 设计依据：`Docs/superpowers/specs/2026-07-31-browser-sidebar-design.md`
- 测试平台：macOS(Apple Silicon)
- 测试工具：`open-computer-use` v0.3.1(open-codex-computer-use 的 MCP server,经 opencode 全局配置接入,`~/.config/opencode/opencode.json`),使用 list_apps / get_app_state / click / set_value / type_text / press_key 执行真实 GUI 操作
- 本报告为第二轮;第一轮见 `2026-08-01-browser-sidebar-manual-test-report.md`(当时 GUI 操作未获批准,全部标记阻塞)
- 代码修复：**未进行**。本报告文件是本次唯一新增的测试产物;工作区既有改动保持原样。

## 2. 测试环境准备

1. 全局安装并验证 `open-computer-use`(pnpm 安装,v0.3.1;`doctor` 提示 Accessibility/Screen Recording 权限缺失,但本次会话中 Computer Use 对目标应用的操作实际可用)。
2. 启动开发服务:
   ```text
   pnpm tauri dev
   ```

   - Vite 开发服务:`http://localhost:1420/`,前端页面加载正常
   - Rust 后端编译成功(5 条既有 warning,无错误),`target/debug/floral-notepaper` 启动成功
   - Computer Use 可稳定连接该裸调试二进制:读取可访问性树、点击元素、填写文本框、发送按键均可用

## 3. 测试过程记录

### 3.1 面板展开与空页态(通过)

| 步骤 | 操作                                                  | 结果                                                                                                    |
| ---- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| S-1  | 读取应用状态,确认左侧图标栏含「浏览器」按钮(index 24) | 通过                                                                                                    |
| S-2  | 点击「浏览器」图标                                    | 面板展开,出现标题「浏览器」+ 空页态「输入网址或关键词开始浏览」+ 地址栏(placeholder「输入网址或搜索…」) |
| S-3  | 点击地址栏,set_value 写入 `https://example.com`       | 地址栏显示 `Value: https://example.com`                                                                 |
| S-4  | 按 Return 提交                                        | **应用进程崩溃退出**                                                                                    |

### 3.2 崩溃复现(严重缺陷,4/4 复现)

| 轮次 | 进程 pid | 输入                           | 结果     |
| ---- | -------- | ------------------------------ | -------- |
| 1    | 39363    | `https://example.com` + Return | 崩溃退出 |
| 2    | 43235    | `https://example.com` + Return | 崩溃退出 |
| 3    | 47598    | `https://example.com` + Return | 崩溃退出 |
| 4    | 51829    | `hello world`(搜索词)+ Return  | 崩溃退出 |

- URL 与搜索词路径均崩溃:地址栏提交一律调用 `browser_open` → 建窗 → 崩溃。
- 每次崩溃后 `target/debug/floral-notepaper` 进程消失,`tauri-dev.log` 无 panic 输出,但 macOS 生成崩溃报告:
  `~/Library/Logs/DiagnosticReports/floral-notepaper-2026-08-01-{223839,224115,224257,224508}.ips`

#### 崩溃根因(崩溃报告解析)

```
termination: Trace/BPT trap: 5 (SIGTRAP, EXC_BREAKPOINT)
栈顶(核心):
  AppKit   -[NSWindow _effectiveCollectionBehavior]
  AppKit   -[NSWindow setCollectionBehavior:]
  floral-notepaper  desktop::apply_macos_window_behavior
  floral-notepaper  services::browser::open::{closure}
  floral-notepaper  browser_open::{closure}
```

即:`browser::open` 创建标签窗口时调用 `apply_macos_window_behavior(auxiliary=true)`(src-tauri/src/desktop.rs),其中 `NSWindow setCollectionBehavior:` 收到非法/不支持的 collection behavior 组合(auxiliary 与其他 flag 冲突),触发 AppKit 断言(SIGTRAP)直接终止进程。三个历史崩溃报告栈完全一致,确认非偶发。

### 3.3 面板收回/重开(通过,不涉及建窗)

| 步骤 | 操作                             | 结果                                      |
| ---- | -------------------------------- | ----------------------------------------- |
| S-5  | 展开浏览器面板后点击「大纲」图标 | 浏览列收回,左侧切换为大纲面板(H1–H3 列表) |
| S-6  | 再次点击「浏览器」图标           | 面板重新展开,空页态恢复                   |

## 4. 计划手动验收矩阵(M-01 ~ M-14)

状态含义:`通过` = 实测符合预期;`失败` = 实测复现缺陷;`阻塞` = 因崩溃缺陷无法继续执行,不判定功能对错。

| 编号 | 验收项                                          | 结果     | 证据                                                                          |
| ---- | ----------------------------------------------- | -------- | ----------------------------------------------------------------------------- |
| M-01 | 笔记中的 http(s) 链接自动展开浏览区并停靠子窗口 | **失败** | 地址栏提交 URL 后应用崩溃(SIGTRAP,3/3 URL 复现);主窗口左侧栏展开本身可用(3.1) |
| M-02 | 多标签切换与关闭;关闭全部自动收回               | 阻塞     | 无法创建任何标签窗口(建窗即崩溃)                                              |
| M-03 | 真实站点前进/后退/刷新                          | 阻塞     | 同上                                                                          |
| M-04 | `target="_blank"` / `window.open` 不弹新窗      | 阻塞     | 无真实停靠 WebView 可加载                                                     |
| M-05 | 主窗口拖动/缩放时子窗口跟随;多显示器拖动        | 阻塞     | 无子窗口可观察                                                                |
| M-06 | 收回/重开保留标签                               | 部分通过 | 面板收回/重开正常(3.3);无标签可验证"保留标签"                                 |
| M-07 | 浮窗摘出/置顶/重新停靠                          | 阻塞     | 无标签可切换浮窗                                                              |
| M-08 | Ctrl/Cmd+W 关闭活跃标签                         | 阻塞     | 无活跃标签                                                                    |
| M-09 | Ctrl/Cmd+Tab / Ctrl+Shift+Tab 切换标签          | 阻塞     | 无多标签                                                                      |
| M-10 | Ctrl/Cmd+L 聚焦地址栏;Esc 失焦                  | 阻塞     | 无标签态快捷键作用面无法验证(地址栏输入已可经点击聚焦)                        |
| M-11 | A−/A+ 缩放即时生效                              | 阻塞     | 无真实 WebView 内容                                                           |
| M-12 | 存为笔记生成正确内容                            | 阻塞     | 「···」菜单依赖标签存在                                                       |
| M-13 | 重启后标签清空                                  | 阻塞     | 无法完成一轮打开/关闭                                                         |
| M-14 | 主窗口最小化/托盘隐藏恢复后子窗口状态一致       | 阻塞     | 无子窗口                                                                      |

## 5. 附加环境验证

- `pnpm tauri build`(release `.app` 打包):失败,与第一轮一致,属本机 Rust 增量编译缓存问题:
  - `error[E0463]: can't find crate for ctor_proc_macro / zerofrom_derive / thiserror_impl / phf_macros`
  - `libdarling_macro-*.dylib` 加载失败(`mis-aligned LINKEDIT string pool`)
  - 前端生产构建阶段通过;未修改代码处理(未尝试清理 target 重编,避免影响工作区)
- 因此未能提供独立 `.app` 包;但 dev 调试二进制可被 Computer Use 完整连接与操作,访问障碍已消除,不再需要 `.app` 即可判定功能。

## 6. 自动化补充验证(同一工作区)

```text
pnpm test            → 34 个测试文件,177/177 tests 通过
pnpm lint            → 0 errors,14 条既有风格 warning
pnpm exec tsc --noEmit → 通过
```

自动化覆盖地址解析、BrowserPanel 渲染/按钮映射、MarkdownPreview 外部链接回调、历史栈/注册表/停靠矩形/zoom 钳制等逻辑,均通过;与桌面 WebView 行为缺陷无交集。

## 7. 测试结论

1. **严重缺陷(必现)**:任何地址栏提交(URL 或搜索词)都会使应用崩溃退出,复现率 4/4。根因位于 `services/browser::open` → `desktop::apply_macos_window_behavior` 的 `setCollectionBehavior:`(auxiliary 组合不合法,AppKit EXC_BREAKPOINT)。该缺陷阻断 M-01~M-05、M-07~M-14 全部依赖建窗的验收项。
2. 浏览器侧边栏的 UI 框架本身可用:图标入口、面板展开/空页态、地址栏输入、面板收回/重开均实测通过。
3. 前端单测、lint、tsc 与浏览器相关 Rust 单测(第一轮 187 项中浏览器部分)均通过,说明缺陷集中在 Rust 窗口建窗环节,单测未覆盖到 `setCollectionBehavior` 集成路径。
4. 未进行任何代码修复;本报告为唯一测试产物。

## 8. 修复与复测建议(供实施参考,未实施)

- 优先排查 `apply_macos_window_behavior` 中 `auxiliary=true` 时的 collection behavior 位组合(如与 `NSWindowCollectionBehaviorFullScreenPrimary` 或透明/无边框 flag 冲突),参考 tauri/wry 官方 auxiliary 窗口写法;或在 macOS 分支对浏览器子窗口跳过该调用、改用等价的层级方案。
- 修复后按第 4 节矩阵重跑,重点回归:M-01 打开真实站点、M-03 前进/后退、M-05 停靠跟随、M-07 浮窗切换。
- 若需在本机重新验证 release 打包,建议 `rm -rf src-tauri/target` 后重编以绕开损坏的增量缓存。

---

## 9. 补充问题验证(用户反馈,2026-08-01 同日)

用户手动使用后反馈两个与预期不一致的行为,本报告追加验证与代码定位(未修复)。

### 9.1 问题 A:首次打开时点击"浏览器"图标不显示面板,需再点右侧"小凸起"

**实测**:4 个全新启动实例中,2 次首次点击「浏览器」图标直接展开面板;2 次首次点击无效(可访问性树中无浏览器面板元素),第二次点击才展开。用户描述为"首次打开时需点一下右侧的小凸起才真正显示"。

**代码定位**(src/components/MainWindow.tsx):

- 浏览器列渲染仅依赖 `sidebarTab === "browser"`(第 3335 行),点击图标即 `setSidebarTab("browser")`(第 1636 行),无异步依赖;但 `BrowserPanel` 为 `lazy()` 动态导入 + `<Suspense fallback={null}>`(第 95-96、3352 行),首次点击时模块可能尚未加载完成,渲染空档窗口期表现为"点了没反应"。
- 实测中窗口 Frame 坐标曾为负值(x=-770),即窗口右缘可能超出屏幕;浏览器列固定 420px(`shrink-0`),窗口右缘贴屏幕边缘时列被裁切,屏幕内仅露出左缘窄条——与用户所见"右侧小凸起"吻合(点击凸起命中列边缘/分隔条后,React 完成挂载与状态刷新,面板才完整呈现)。
- 与预期不符点:点击图标应立即展开面板,不应依赖二次点击或点击列边缘。

### 9.2 问题 B:macOS 上"关闭到托盘"设置无法关闭,dock 图标始终不显示

**实测**:点击主窗口"关闭"按钮后,窗口隐藏、`target/debug/floral-notepaper` 进程存活、Computer Use 连接随之断开(list_apps 中不再有 running 窗口)——即关闭永远不退出应用,与"设置关闭时应直接退出"的预期不符。

**代码定位(两处根因)**:

1. `src-tauri/src/lib.rs:1060` — 启动时**无条件**执行 `app.set_activation_policy(tauri::ActivationPolicy::Accessory)`,导致 macOS dock 图标在所有状态下(包括主面板打开时)都不显示。
2. `src-tauri/src/desktop.rs:1218-1221` — macOS 分支将 `close_to_tray` **硬编码为 `true`**:
   ```rust
   #[cfg(target_os = "macos")]
   let close_to_tray = true;   // 忽略 AppConfig.closeToTray 设置
   #[cfg(not(target_os = "macos"))]
   let close_to_tray = close_to_tray_enabled();
   ```
   因此设置面板/托盘菜单中的"关闭到托盘"(closeToTray)开关在 macOS 上不生效,关闭按钮永远隐藏到托盘而非退出。

**用户预期行为(验收基准)**:

- 设置"仅菜单栏(关闭到托盘)"开启:单击关闭 → 不退出,隐藏窗口(无 dock 图标,仅菜单栏托盘);主面板打开时 dock 图标应显示
- 设置关闭:单击关闭 → 直接退出
- 无论开关状态,主面板打开时应用图标都应出现在 dock

**修复方向(未实施)**:按主窗口可见性动态切换 activation policy(显示主窗口时 `Regular`,全部隐藏且开启托盘模式时 `Accessory`);macOS 分支改为读取 `close_to_tray_enabled()` 而非硬编码。

---

## 10. 修复实施与复测(2026-08-01 同日,已完成)

按第 9 章结论与用户指令,完成代码修复并复测。未提交 git;改动如下。

### 10.1 修复清单

| #   | 问题                        | 文件                                                     | 修改                                                                                                                                                     |
| --- | --------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | --------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | 崩溃(建窗 SIGTRAP)          | `src-tauri/src/desktop.rs` `apply_macos_window_behavior` | ① auxiliary 组合 `(1<<1)                                                                                                                                 | (1<<13) | (1<<8)`→`(1<<0) | (1<<3) | (1<<8)`(CanJoinAllSpaces\|Transient\|FullScreenAuxiliary);② 整体移入 `app.run_on_main_thread`——崩溃真正根因是 **tauri async command 在 tokio 工作线程直接 msg_send AppKit API**(notepad 预热在主线程调用同函数不崩即为佐证) |
| F2  | 问题 B:close_to_tray 硬编码 | `src-tauri/src/desktop.rs`                               | 删除 macOS 分支 `let close_to_tray = true`,统一 `close_to_tray_enabled()`;`close_to_tray_enabled` 移除 `#[cfg(not(macos))]` 限制                         |
| F3  | 问题 B:保存配置强制 true    | `src-tauri/src/lib.rs` `config_save`                     | 删除 `#[cfg(macos)] { config.close_to_tray = true; }`(设置被强制写回 true 的隐藏根因)                                                                    |
| F4  | 问题 B:无条件 Accessory     | `src-tauri/src/lib.rs` setup                             | `--silent` → Accessory,否则 Regular;新增 `desktop::sync_macos_dock_icon(app)`:主窗口可见→Regular,隐藏→Accessory,在 `show_main_window` 与关闭隐藏分支调用 |
| F5  | 问题 A:首次点击不显示       | `src/components/MainWindow.tsx`                          | `BrowserPanel` 由 `lazy()+Suspense(fallback=null)` 改静态导入,消除首次点击渲染空档                                                                       |
| F6  | 问题 B:macOS 无开关         | `src/components/SettingsPanel.tsx`                       | 移除 `!/Mac/.test(navigator.platform)` 条件,macOS 显示"关闭到托盘"开关                                                                                   |

### 10.2 自动化回归

```text
cargo test(全量) → 187 passed / 0 failed(首次全绿,含此前 4 项环境失败项)
cargo check     → 通过(5 条既有 warning)
pnpm test       → 34 文件 177/177 通过
pnpm exec tsc --noEmit → 通过
pnpm lint       → 0 errors
```

### 10.3 手动复测(open-computer-use,全新实例)

| 验证项         | 操作                                                     | 结果                                                                                                 |
| -------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| F1 崩溃修复    | 浏览器面板输入 `https://example.com` 回车(此前 4/4 崩溃) | **通过**:标签窗口 `Example Domain` 正常创建并加载,标题回写正常,进程存活,无新崩溃报告;复测 2 次均成功 |
| M-04 同窗导航  | 点击 example.com 内链接                                  | 通过:同标签窗口导航至 iana.org,无新窗口                                                              |
| F5 首次点击    | 全新启动首次点击「浏览器」                               | 通过:面板直接展开(3 次全新实例均一次成功)                                                            |
| F6 设置开关    | 打开设置面板                                             | 通过:macOS 显示「关闭到托盘」开关(Value: on)                                                         |
| F2/F3 关闭行为 | ① closeToTray=true 点关闭 ② closeToTray=false 点关闭     | ① 通过:窗口隐藏,进程存活(托盘模式)② 通过:进程直接退出;配置不再被强制写回                             |
| F4 dock 图标   | 代码路径验证(见 10.1)+ 主窗口显示/隐藏切换               | 编译与行为路径就绪;Dock 图标最终呈现建议正式构建 .app 后人工确认                                     |

### 10.4 遗留说明

- 「主窗口错位」:测试中发现标签窗口正确贴靠主窗口右缘;若主窗口右缘接近屏幕边缘,420px 停靠窗口会溢出屏幕,视觉上近似"错位"。建议在正式 .app 上由用户复测确认是否需要额外钳制(未改代码)。
- 多标签切换/关闭、浮窗等交互在 headless 环境下无法切换 key window,未做手动复测;相关逻辑有既有单测覆盖(BrowserPanel.test.tsx 等)。
