export type ViewMode = "wysiwyg" | "source" | "read";

export type ThemeOption = "light" | "dark" | "system";

export type TileColorMode = "system" | "custom";
export type BackgroundFit = "cover" | "contain" | "repeat";

export interface AppConfig {
  locale: string;
  dataDir: string;
  /** Legacy single notes dir（旧配置读取，新配置不再写入） */
  notesDir?: string;
  notesDirs: string[];
  globalShortcut: string;
  closeToTray: boolean;
  autostart: boolean;
  defaultViewMode: string;
  noteAutoSave: boolean;
  noteSurfaceAutoSave: boolean;
  tileColor: string;
  tileColorMode: TileColorMode;
  theme: ThemeOption;
  fontSize: number;
  surfaceFontSize: number;
  tabIndentSize: number;
  externalFileAutoSave: boolean;
  aiEnabled: boolean;
  aiApiKey: string;
  aiApiEndpoint: string;
  aiModel: string;
  aiFimEndpoint: string;
  aiTitleModel: string;
  aiTitlePrompt: string;
  aiContinuePrompt: string;
  aiFimPrompt: string;
  aiFormatModel: string;
  aiFormatPrompt: string;
  rememberSurfaceSize: boolean;
  tileCtrlClose: boolean;
  tileDoubleClickToEdit: boolean;
  tileSaveReturnsToPin: boolean;
  tileRenderMarkdown: boolean;
  renderHtmlMarkdown: boolean;
  splitScrollSync: boolean;
  surfaceWidth?: number;
  surfaceHeight?: number;
  toggleVisibilityShortcut: string;
  openAtCursor: boolean;
  backgroundImagePath?: string;
  backgroundFit?: BackgroundFit;
  backgroundDim?: number;
  backgroundBlur?: number;
  backgroundScale?: number;
  backgroundPositionX?: number;
  backgroundPositionY?: number;
  hiddenCategories?: string[];
  /** Tab management: persisted tab list (noteId array) */
  openTabs?: string[];
  /** Tab management: last active tab id */
  activeTabId?: string;
  /** Tab layout mode: "compact" embeds tabs in the title bar, "default" places them below */
  tabLayout?: "compact" | "default";
  /** Auto-open outline panel when scrolling past headings */
  autoOpenOutline?: boolean;
}
