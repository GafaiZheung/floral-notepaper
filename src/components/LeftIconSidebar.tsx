import { useTranslation } from "react-i18next";

export type SidebarPanel = "directory" | "outline" | "git" | "browser";

interface LeftIconSidebarProps {
  activePanel: SidebarPanel;
  browserActive?: boolean;
  onSelectPanel: (panel: SidebarPanel) => void;
  onSettings: () => void;
}

export function LeftIconSidebar({
  activePanel,
  browserActive = false,
  onSelectPanel,
  onSettings,
}: LeftIconSidebarProps) {
  const { t } = useTranslation();

  return (
    <div className="w-11 shrink-0 flex flex-col items-center border-r border-paper-deep/30 bg-paper/30 py-2 select-none">
      {/* Directory icon */}
      <button
        onClick={() => onSelectPanel("directory")}
        className={`w-9 h-9 flex items-center justify-center rounded-lg mb-1 transition-all cursor-pointer ${
          activePanel === "directory"
            ? "text-bamboo bg-bamboo-mist/60 shadow-sm"
            : "text-ink-ghost hover:text-ink-faint hover:bg-paper-warm"
        }`}
        title={t("main.sidebar.tabDirectory", { defaultValue: "目录" })}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>
      </button>

      {/* Outline icon */}
      <button
        onClick={() => onSelectPanel("outline")}
        className={`w-9 h-9 flex items-center justify-center rounded-lg mb-1 transition-all cursor-pointer ${
          activePanel === "outline"
            ? "text-bamboo bg-bamboo-mist/60 shadow-sm"
            : "text-ink-ghost hover:text-ink-faint hover:bg-paper-warm"
        }`}
        title={t("main.sidebar.tabOutline", { defaultValue: "大纲" })}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="8" y1="6" x2="21" y2="6" />
          <line x1="8" y1="12" x2="21" y2="12" />
          <line x1="8" y1="18" x2="21" y2="18" />
          <line x1="3" y1="6" x2="3.01" y2="6" />
          <line x1="3" y1="12" x2="3.01" y2="12" />
          <line x1="3" y1="18" x2="3.01" y2="18" />
        </svg>
      </button>

      {/* Git icon */}
      <button
        onClick={() => onSelectPanel("git")}
        className={`w-9 h-9 flex items-center justify-center rounded-lg mb-1 transition-all cursor-pointer ${
          activePanel === "git"
            ? "text-bamboo bg-bamboo-mist/60 shadow-sm"
            : "text-ink-ghost hover:text-ink-faint hover:bg-paper-warm"
        }`}
        title={t("main.sidebar.tabGit", { defaultValue: "Git 版本管理" })}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="18" r="3" />
          <circle cx="6" cy="6" r="3" />
          <circle cx="18" cy="6" r="3" />
          <path d="M18 9v1a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V9" />
          <path d="M12 3v4" />
        </svg>
      </button>

      {/* Browser icon */}
      <button
        onClick={() => onSelectPanel("browser")}
        className={`w-9 h-9 flex items-center justify-center rounded-lg mb-1 transition-all cursor-pointer ${
          browserActive
            ? "text-bamboo bg-bamboo-mist/60 shadow-sm"
            : "text-ink-ghost hover:text-ink-faint hover:bg-paper-warm"
        }`}
        title={t("main.sidebar.tabBrowser", { defaultValue: "浏览器" })}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
          <path d="M2 12h20" />
        </svg>
      </button>

      {/* Spacer pushes settings to bottom */}
      <div className="flex-1" />

      {/* Settings icon at bottom */}
      <button
        onClick={onSettings}
        className="w-9 h-9 flex items-center justify-center rounded-lg transition-all cursor-pointer text-ink-ghost hover:text-ink-faint hover:bg-paper-warm"
        title={t("main.window.settings", { defaultValue: "设置" })}
      >
        <svg
          width="18"
          height="18"
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
      </button>
    </div>
  );
}
