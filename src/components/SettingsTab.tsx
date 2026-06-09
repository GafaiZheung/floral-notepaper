import { invoke } from "@tauri-apps/api/core";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { chooseBackgroundImage } from "../features/settings/api";
import type {
  AppConfig,
  BackgroundFit,
  ThemeOption,
  TileColorMode,
  ViewMode,
} from "../features/settings/types";
import { DEFAULT_TILE_COLOR, normalizeTileColor } from "../features/settings/tileColor";
import { applyTheme, watchSystemTheme } from "../features/settings/theme";
import { SUPPORTED_LOCALES } from "../locales/locale-whitelist";
import { SlidingButtonGroup } from "./SlidingButtonGroup";
import { OneDriveSettings } from "../features/onedrive/OneDriveSettings";
import { ToggleRow, RangeRow, ShortcutRecorder } from "./SettingsPanel";

const HARMONY_FONT_LICENSE_URL = new URL("../assets/fonts/LICENSE_Fonts", import.meta.url).href;

// ── Settings category definitions ──

interface SettingsCategory {
  id: string;
  label: string;
  icon: React.ReactNode;
}

// ── Props ──

interface SettingsTabProps {
  config: AppConfig;
  onChange: (config: AppConfig) => void;
  onChooseNotesDir: () => void;
}

// ── Main SettingsTab Component ──

export function SettingsTab({ config, onChange, onChooseNotesDir }: SettingsTabProps) {
  const { t } = useTranslation();
  const [activeCategory, setActiveCategory] = useState("general");

  const setConfigValue = <Key extends keyof AppConfig>(key: Key, value: AppConfig[Key]) => {
    onChange({ ...config, [key]: value });
  };

  const tileColorModes = useMemo<Array<{ value: TileColorMode; label: string }>>(
    () => [
      { value: "system", label: t("settings.tileColor.followTheme", { defaultValue: "跟随主题" }) },
      { value: "custom", label: t("settings.tileColor.custom", { defaultValue: "自定义" }) },
    ],
    [t],
  );

  const themeOptions = useMemo<Array<{ value: ThemeOption; label: string }>>(
    () => [
      { value: "light", label: t("settings.theme.light", { defaultValue: "浅色" }) },
      { value: "dark", label: t("settings.theme.dark", { defaultValue: "深色" }) },
      { value: "system", label: t("settings.theme.system", { defaultValue: "跟随系统" }) },
    ],
    [t],
  );

  const viewModes = useMemo<Array<{ value: ViewMode; label: string }>>(
    () => [
      { value: "wysiwyg", label: t("settings.defaultView.wysiwyg", { defaultValue: "阅读编辑" }) },
      { value: "source", label: t("settings.defaultView.source", { defaultValue: "源码编辑" }) },
    ],
    [t],
  );

  const backgroundFits = useMemo<Array<{ value: BackgroundFit; label: string }>>(
    () => [
      { value: "cover", label: t("settings.background.fit.cover", { defaultValue: "填充" }) },
      { value: "contain", label: t("settings.background.fit.contain", { defaultValue: "完整" }) },
      { value: "repeat", label: t("settings.background.fit.repeat", { defaultValue: "平铺" }) },
    ],
    [t],
  );

  const localeOptions = useMemo(
    () =>
      SUPPORTED_LOCALES.map((locale) => ({
        value: locale,
        label:
          locale === "zh-CN"
            ? t("settings.locale.zhCN", { defaultValue: "简体中文" })
            : locale === "en-US"
              ? t("settings.locale.enUS", { defaultValue: "English" })
              : t("settings.locale.zhHK", { defaultValue: "繁體中文" }),
      })),
    [t],
  );

  const categories: SettingsCategory[] = useMemo(
    () => [
      {
        id: "general",
        label: t("settings.category.general", { defaultValue: "通用" }),
        icon: (
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        ),
      },
      {
        id: "editor",
        label: t("settings.category.editor", { defaultValue: "编辑器" }),
        icon: (
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="16 18 22 12 16 6" />
            <polyline points="8 6 2 12 8 18" />
          </svg>
        ),
      },
      {
        id: "appearance",
        label: t("settings.category.appearance", { defaultValue: "外观" }),
        icon: (
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        ),
      },
      {
        id: "shortcuts",
        label: t("settings.category.shortcuts", { defaultValue: "快捷键" }),
        icon: (
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="2" y="4" width="20" height="16" rx="2" />
            <path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M8 12h.01M12 12h.01M16 12h.01M8 16h8" />
          </svg>
        ),
      },
      {
        id: "sync",
        label: t("settings.category.sync", { defaultValue: "同步" }),
        icon: (
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M6.5 17.5c-2.3-.5-4-2.5-4-4.9 0-3 2.3-5 5-4.8.8-2.7 3.3-4.5 6.1-4.1a5.2 5.2 0 0 1 3.6 2.1c2.7.2 4.8 2.6 4.8 5.3 0 2.3-1.3 4.2-3.2 5.1" />
            <path d="M12 22v-6" />
            <path d="m9 19 3 3 3-3" />
          </svg>
        ),
      },
      {
        id: "about",
        label: t("settings.category.about", { defaultValue: "关于" }),
        icon: (
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
        ),
      },
    ],
    [t],
  );

  const renderCategoryContent = () => {
    switch (activeCategory) {
      case "general":
        return (
          <div className="space-y-5 animate-view-fade">
            <section className="space-y-2">
              <label className="block text-[11px] font-body text-ink-faint">
                {t("settings.notesDir", { defaultValue: "笔记目录" })}
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={config.notesDir}
                  readOnly
                  className="min-w-0 flex-1 h-8 px-2.5 rounded-lg bg-paper-warm/70 border border-paper-deep/40 text-[11px] font-mono text-ink-faint truncate"
                />
                <button
                  type="button"
                  onClick={onChooseNotesDir}
                  className="h-8 px-3 rounded-lg border border-paper-deep/45 text-[11px] text-ink-faint hover:text-bamboo hover:bg-bamboo-mist/50 transition-colors cursor-pointer"
                >
                  {t("settings.selectFolder", { defaultValue: "选择文件夹" })}
                </button>
              </div>
            </section>

            <section className="space-y-2">
              <label className="block text-[11px] font-body text-ink-faint">
                {t("settings.locale.label", { defaultValue: "语言" })}
              </label>
              <SlidingButtonGroup
                options={localeOptions}
                value={config.locale}
                onChange={(value) => setConfigValue("locale", value)}
              />
            </section>

            <section className="space-y-2">
              <ToggleRow
                label={t("settings.closeToTray", { defaultValue: "关闭到托盘" })}
                checked={config.closeToTray}
                onChange={(checked) => setConfigValue("closeToTray", checked)}
              />
              <ToggleRow
                label={t("settings.autostart", { defaultValue: "开机自启" })}
                checked={config.autostart}
                onChange={(checked) => setConfigValue("autostart", checked)}
              />
              <ToggleRow
                label={t("settings.tabsInTitlebar", { defaultValue: "标签页集成到标题栏" })}
                checked={config.tabsInTitlebar ?? true}
                onChange={(checked) => setConfigValue("tabsInTitlebar", checked)}
              />
            </section>
          </div>
        );

      case "editor":
        return (
          <div className="space-y-5 animate-view-fade">
            <section className="space-y-2">
              <label className="block text-[11px] font-body text-ink-faint">
                {t("settings.defaultView.label", { defaultValue: "默认视图" })}
              </label>
              <SlidingButtonGroup
                options={viewModes}
                value={config.defaultViewMode}
                onChange={(v) => setConfigValue("defaultViewMode", v)}
              />
            </section>

            <section className="space-y-2">
              <ToggleRow
                label={t("settings.autoSave.note", { defaultValue: "自动保存笔记" })}
                checked={config.noteAutoSave}
                onChange={(checked) => setConfigValue("noteAutoSave", checked)}
              />
              <ToggleRow
                label={t("settings.autoSave.surface", { defaultValue: "小窗笔记自动保存" })}
                checked={config.noteSurfaceAutoSave}
                onChange={(checked) => setConfigValue("noteSurfaceAutoSave", checked)}
              />
              <ToggleRow
                label={t("settings.autoSave.externalFile", { defaultValue: "外部文件自动保存" })}
                checked={config.externalFileAutoSave}
                onChange={(checked) => setConfigValue("externalFileAutoSave", checked)}
              />
            </section>

            <section className="space-y-2">
              <label className="block text-[11px] font-body text-ink-faint">
                {t("settings.fontSize.editor", { defaultValue: "编辑器字号" })}
              </label>
              <RangeRow
                label=""
                value={config.fontSize ?? 14}
                min={8}
                max={30}
                step={1}
                format={(v) => `${v}px`}
                onChange={(v) => setConfigValue("fontSize", v)}
              />
            </section>

            <section className="space-y-2">
              <label className="block text-[11px] font-body text-ink-faint">
                {t("settings.fontSize.surface", { defaultValue: "小窗/磁贴字号" })}
              </label>
              <RangeRow
                label=""
                value={config.surfaceFontSize ?? 14}
                min={8}
                max={30}
                step={1}
                format={(v) => `${v}px`}
                onChange={(v) => setConfigValue("surfaceFontSize", v)}
              />
            </section>

            <section className="space-y-2">
              <label className="block text-[11px] font-body text-ink-faint">
                {t("settings.tabIndentSize", { defaultValue: "Tab 缩进宽度" })}
              </label>
              <RangeRow
                label=""
                value={config.tabIndentSize ?? 2}
                min={1}
                max={8}
                step={1}
                format={(v) => String(v)}
                onChange={(v) => setConfigValue("tabIndentSize", v)}
              />
            </section>
          </div>
        );

      case "appearance":
        return (
          <div className="space-y-5 animate-view-fade">
            <section className="space-y-2">
              <label className="block text-[11px] font-body text-ink-faint">
                {t("settings.theme.label", { defaultValue: "主题" })}
              </label>
              <SlidingButtonGroup
                options={themeOptions}
                value={config.theme}
                onChange={(v: ThemeOption) => {
                  setConfigValue("theme", v);
                  applyTheme(v);
                  watchSystemTheme(v);
                }}
              />
            </section>

            <section className="space-y-2">
              <label className="block text-[11px] font-body text-ink-faint">
                {t("settings.tileColor.label", { defaultValue: "磁贴颜色" })}
              </label>
              <SlidingButtonGroup
                options={tileColorModes}
                value={config.tileColorMode}
                onChange={(v: TileColorMode) => setConfigValue("tileColorMode", v)}
              />
              {config.tileColorMode === "custom" && (
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={normalizeTileColor(config.tileColor)}
                    onChange={(event) => setConfigValue("tileColor", event.target.value)}
                    className="w-10 h-8 rounded-lg border border-paper-deep/40 bg-paper-warm/70 cursor-pointer"
                  />
                  <input
                    type="text"
                    value={config.tileColor}
                    onChange={(event) => setConfigValue("tileColor", event.target.value)}
                    placeholder="#f6f3ec"
                    spellCheck={false}
                    className="min-w-0 flex-1 h-8 px-2.5 rounded-lg bg-paper-warm/70 border border-paper-deep/40 text-[12px] font-mono text-ink-soft outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setConfigValue("tileColor", DEFAULT_TILE_COLOR)}
                    className="h-8 px-2.5 rounded-lg border border-paper-deep/45 text-[11px] text-ink-faint hover:text-bamboo hover:bg-bamboo-mist/50 transition-colors cursor-pointer whitespace-nowrap"
                  >
                    {t("common.default", { defaultValue: "默认" })}
                  </button>
                </div>
              )}
            </section>

            <section className="space-y-2">
              <label className="block text-[11px] font-body text-ink-faint">
                {t("settings.background.label", { defaultValue: "背景图片" })}
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={
                    (config.backgroundImagePath &&
                      (localStorage.getItem("backgroundImageName") ||
                        config.backgroundImagePath.split(/[/\\]/).pop())) ||
                    t("settings.background.default", { defaultValue: "默认背景" })
                  }
                  readOnly
                  className="min-w-0 flex-1 h-8 px-2.5 rounded-lg bg-paper-warm/70 border border-paper-deep/40 text-[11px] font-mono text-ink-faint truncate"
                />
                <button
                  type="button"
                  onClick={() => {
                    void chooseBackgroundImage().then(async (path) => {
                      if (!path) return;
                      const originalName = path.split(/[/\\]/).pop() ?? "";
                      const saved = await invoke<string>("copy_background_image", {
                        sourcePath: path,
                      });
                      localStorage.setItem("backgroundImageName", originalName);
                      setConfigValue("backgroundImagePath", saved);
                    });
                  }}
                  className="h-8 px-3 rounded-lg border border-paper-deep/45 text-[11px] text-ink-faint hover:text-bamboo hover:bg-bamboo-mist/50 transition-colors cursor-pointer"
                >
                  {t("settings.background.choose", { defaultValue: "选择" })}
                </button>
                {config.backgroundImagePath && (
                  <button
                    type="button"
                    onClick={() => {
                      localStorage.removeItem("backgroundImageName");
                      setConfigValue("backgroundImagePath", "");
                    }}
                    className="h-8 px-3 rounded-lg border border-red-400/40 text-[11px] text-red-400 hover:bg-red-400/10 transition-colors cursor-pointer"
                  >
                    {t("settings.background.clear", { defaultValue: "清除" })}
                  </button>
                )}
              </div>
              <SlidingButtonGroup
                options={backgroundFits}
                value={config.backgroundFit ?? "cover"}
                onChange={(value: BackgroundFit) => setConfigValue("backgroundFit", value)}
              />
              <RangeRow
                label={t("settings.background.dim", { defaultValue: "遮罩" })}
                value={config.backgroundDim ?? 0.25}
                min={0}
                max={1}
                step={0.01}
                format={(value) => `${Math.round(value * 100)}%`}
                onChange={(value) => setConfigValue("backgroundDim", value)}
              />
              <RangeRow
                label={t("settings.background.scale", { defaultValue: "缩放" })}
                value={config.backgroundScale ?? 1}
                min={0.5}
                max={2}
                step={0.05}
                format={(value) => `${Math.round(value * 100)}%`}
                onChange={(value) => setConfigValue("backgroundScale", value)}
              />
              <RangeRow
                label={t("settings.background.positionX", { defaultValue: "横向" })}
                value={config.backgroundPositionX ?? 50}
                min={0}
                max={100}
                step={1}
                format={(value) => `${value}%`}
                onChange={(value) => setConfigValue("backgroundPositionX", value)}
              />
              <RangeRow
                label={t("settings.background.positionY", { defaultValue: "纵向" })}
                value={config.backgroundPositionY ?? 50}
                min={0}
                max={100}
                step={1}
                format={(value) => `${value}%`}
                onChange={(value) => setConfigValue("backgroundPositionY", value)}
              />
              <RangeRow
                label={t("settings.background.blur", { defaultValue: "模糊" })}
                value={config.backgroundBlur ?? 0}
                min={0}
                max={20}
                step={1}
                format={(value) => `${value}px`}
                onChange={(value) => setConfigValue("backgroundBlur", value)}
              />
            </section>
          </div>
        );

      case "shortcuts":
        return (
          <div className="space-y-5 animate-view-fade">
            <section className="space-y-2">
              <ToggleRow
                label={t("settings.rememberSurfaceSize", { defaultValue: "记住小窗尺寸" })}
                checked={config.rememberSurfaceSize}
                onChange={(checked) => setConfigValue("rememberSurfaceSize", checked)}
              />
              <ToggleRow
                label={t("settings.tileCtrlClose", { defaultValue: "Ctrl+右键快速关闭磁贴" })}
                checked={config.tileCtrlClose}
                onChange={(checked) => setConfigValue("tileCtrlClose", checked)}
              />
              <ToggleRow
                label={t("settings.openAtCursor", { defaultValue: "快捷键打开时跟随鼠标位置" })}
                checked={config.openAtCursor ?? true}
                onChange={(checked) => setConfigValue("openAtCursor", checked)}
              />
              <ToggleRow
                label={t("settings.tileRenderMarkdown", { defaultValue: "磁贴渲染 Markdown" })}
                checked={config.tileRenderMarkdown}
                onChange={(checked) => setConfigValue("tileRenderMarkdown", checked)}
              />
            </section>

            <section className="space-y-2">
              <label className="block text-[11px] font-body text-ink-faint/70">
                {t("settings.quickNoteShortcut", { defaultValue: "快捷记录快捷键" })}
              </label>
              <ShortcutRecorder
                value={config.globalShortcut}
                onChange={(v) => setConfigValue("globalShortcut", v)}
              />
            </section>

            <section className="space-y-2">
              <label className="block text-[11px] font-body text-ink-faint/70">
                {t("settings.visibilityShortcut", { defaultValue: "显示/隐藏窗口快捷键" })}
              </label>
              <ShortcutRecorder
                value={config.toggleVisibilityShortcut}
                onChange={(v) => setConfigValue("toggleVisibilityShortcut", v)}
              />
            </section>

            <section className="space-y-2">
              <label className="block text-[11px] font-body text-ink-faint">
                {t("settings.hiddenCategories.label", { defaultValue: "隐藏的分类目录" })}
              </label>
              <div className="flex flex-wrap gap-1.5">
                {(config.hiddenCategories ?? []).map((name) => (
                  <span
                    key={name}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono bg-paper-warm border border-paper-deep/40 text-ink-faint"
                  >
                    {name}
                    <button
                      onClick={() =>
                        setConfigValue(
                          "hiddenCategories",
                          (config.hiddenCategories ?? []).filter((c) => c !== name),
                        )
                      }
                      className="text-ink-ghost hover:text-red-400 transition-colors cursor-pointer"
                    >
                      <svg
                        width="10"
                        height="10"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                      >
                        <path d="M18 6L6 18M6 6l12 12" />
                      </svg>
                    </button>
                  </span>
                ))}
              </div>
              <input
                type="text"
                placeholder={t("settings.hiddenCategories.placeholder", {
                  defaultValue: "输入目录名后回车…",
                })}
                className="w-full h-7 px-2.5 rounded-lg text-[11px] font-mono text-ink bg-paper-warm/70 border border-paper-deep/40 focus:border-bamboo/30 placeholder:text-ink-ghost/60"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && e.currentTarget.value.trim()) {
                    const name = e.currentTarget.value.trim();
                    if (!(config.hiddenCategories ?? []).includes(name)) {
                      setConfigValue("hiddenCategories", [
                        ...(config.hiddenCategories ?? []),
                        name,
                      ]);
                    }
                    e.currentTarget.value = "";
                  }
                }}
              />
              <p className="text-[10px] text-ink-ghost/60">
                {t("settings.hiddenCategories.hint", {
                  defaultValue: "这些目录不会在侧栏显示为分类",
                })}
              </p>
            </section>
          </div>
        );

      case "sync":
        return (
          <div className="space-y-5 animate-view-fade">
            <OneDriveSettings config={config} onChange={onChange} />
          </div>
        );

      case "about":
        return (
          <div className="space-y-5 animate-view-fade">
            <section className="pt-2">
              <p className="text-[11px] leading-relaxed text-ink-ghost/75">
                <span>
                  {t("settings.fontNotice", {
                    defaultValue:
                      "Uses HarmonyOS Sans SC font. Copyright 2021 Huawei Device Co., Ltd. Licensed under HarmonyOS Sans Fonts License Agreement.",
                  })}
                </span>{" "}
                <a
                  href={HARMONY_FONT_LICENSE_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-2 hover:text-ink-faint"
                >
                  HarmonyOS Sans Fonts License Agreement
                </a>
              </p>
            </section>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="flex flex-1 min-h-0">
      {/* Left category sidebar */}
      <div className="w-40 shrink-0 border-r border-paper-deep/20 bg-paper/20 flex flex-col py-2">
        {categories.map((cat) => (
          <button
            key={cat.id}
            onClick={() => setActiveCategory(cat.id)}
            className={`flex items-center gap-2.5 px-4 py-2 mx-2 rounded-lg text-[12px] font-body transition-all cursor-pointer ${
              activeCategory === cat.id
                ? "text-bamboo bg-bamboo-mist/60 font-medium shadow-sm"
                : "text-ink-faint hover:text-ink-soft hover:bg-paper-warm/70"
            }`}
          >
            <span className="shrink-0 opacity-70">{cat.icon}</span>
            <span>{cat.label}</span>
          </button>
        ))}
      </div>

      {/* Right content area */}
      <div className="flex-1 overflow-y-auto scrollbar-hidden px-6 py-5">
        {renderCategoryContent()}
      </div>
    </div>
  );
}
