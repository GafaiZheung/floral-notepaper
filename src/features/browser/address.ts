/** 默认搜索引擎（常量配置，后续可加设置项）。 */
export const DEFAULT_SEARCH_URL = "https://www.bing.com/search";

/**
 * 解析地址栏输入：
 * - 空输入 → 返回空字符串（不动作）
 * - 已是 http(s):// 或其他协议（mailto: 等）→ 原样返回
 * - 无空格且形如域名（含点）→ 补 https://
 * - 其余（含空格、纯关键词等）→ 走默认搜索
 */
export function resolveAddressInput(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    return trimmed;
  }

  const hasSpace = /\s/.test(trimmed);
  const looksLikeDomain = !hasSpace && /^[^\s/?#]+(\.[^\s/?#]+)+([/?#:].*)?$/i.test(trimmed);

  if (looksLikeDomain) {
    return `https://${trimmed}`;
  }

  return `${DEFAULT_SEARCH_URL}?q=${encodeURIComponent(trimmed)}`;
}
