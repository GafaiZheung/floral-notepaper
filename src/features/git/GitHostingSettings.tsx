import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { GitHostingAccount } from "./types";
import { loadHostingAccounts, saveHostingAccounts } from "./hostingStorage";

export function GitHostingSettings() {
  const { t } = useTranslation();
  const [accounts, setAccounts] = useState<GitHostingAccount[]>([]);
  const [provider, setProvider] = useState<"github" | "gitlab">("github");
  const [username, setUsername] = useState("");
  const [token, setToken] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setAccounts(loadHostingAccounts());
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (loaded) saveHostingAccounts(accounts);
  }, [accounts, loaded]);

  const addAccount = () => {
    if (!username.trim() || !token.trim()) return;
    setAccounts([
      ...accounts.filter((a) => a.provider !== provider),
      {
        provider,
        username: username.trim(),
        token: token.trim(),
        baseUrl: baseUrl.trim() || undefined,
      },
    ]);
    setUsername("");
    setToken("");
    setBaseUrl("");
  };

  return (
    <section className="space-y-3">
      <label className="block text-[11px] font-body text-ink-faint">
        {t("git.hostingSetupTitle", { defaultValue: "托管账号配置" })}
      </label>

      {/* Saved accounts */}
      {accounts.length > 0 && (
        <div className="space-y-1.5">
          {accounts.map((a) => (
            <div
              key={a.provider}
              className="flex items-center gap-2 pl-2.5 pr-1.5 py-1.5 rounded-lg bg-paper-warm/40 border border-paper-deep/15"
            >
              <span className="text-[10px] font-medium text-bamboo uppercase w-14 shrink-0">
                {a.provider}
              </span>
              <span className="text-[11px] text-ink-soft flex-1 truncate">{a.username}</span>
              {a.baseUrl && (
                <span className="text-[9px] text-ink-ghost truncate max-w-[120px]">
                  {a.baseUrl}
                </span>
              )}
              <button
                onClick={() => setAccounts(accounts.filter((x) => x.provider !== a.provider))}
                className="w-5 h-5 flex items-center justify-center rounded text-ink-ghost hover:text-red-400 hover:bg-red-100/40 dark:hover:bg-red-900/20 transition-colors cursor-pointer shrink-0"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add form */}
      <div className="space-y-2 p-2.5 rounded-lg bg-paper-warm/25 border border-paper-deep/10">
        <p className="text-[10px] text-ink-ghost">
          {t("git.addAccount", { defaultValue: "添加账号" })}
        </p>
        <select
          value={provider}
          onChange={(e) => setProvider(e.target.value as "github" | "gitlab")}
          className="w-full h-8 px-2.5 rounded-lg bg-paper-warm/70 border border-paper-deep/40 text-[11px] text-ink-soft outline-none cursor-pointer"
        >
          <option value="github">GitHub</option>
          <option value="gitlab">GitLab</option>
        </select>
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder={t("git.username", { defaultValue: "用户名" }) as string}
          className="w-full h-8 px-2.5 rounded-lg bg-paper-warm/70 border border-paper-deep/40 text-[11px] text-ink-soft outline-none placeholder:text-ink-ghost"
        />
        <input
          value={token}
          onChange={(e) => setToken(e.target.value)}
          type="password"
          placeholder={
            t("git.tokenPlaceholder", {
              defaultValue: "Personal Access Token",
            }) as string
          }
          className="w-full h-8 px-2.5 rounded-lg bg-paper-warm/70 border border-paper-deep/40 text-[11px] text-ink-soft outline-none placeholder:text-ink-ghost"
        />
        {provider === "gitlab" && (
          <input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder={
              t("git.gitlabUrl", {
                defaultValue: "https://gitlab.com (留空使用默认)",
              }) as string
            }
            className="w-full h-8 px-2.5 rounded-lg bg-paper-warm/70 border border-paper-deep/40 text-[11px] text-ink-soft outline-none placeholder:text-ink-ghost"
          />
        )}
        <button
          onClick={addAccount}
          disabled={!username.trim() || !token.trim()}
          className="h-7 px-3 rounded-lg bg-bamboo text-white text-[11px] font-medium hover:bg-bamboo-dark disabled:opacity-30 transition-colors cursor-pointer"
        >
          {t("git.saveAccount", { defaultValue: "保存账号" })}
        </button>
      </div>

      {/* Token help */}
      <p className="text-[10px] text-ink-ghost/60 leading-relaxed">
        {t("git.tokenHelp", {
          defaultValue:
            "GitHub: Settings → Developer settings → Personal access tokens → Tokens (classic)，需要 repo 权限",
        })}
      </p>
    </section>
  );
}
