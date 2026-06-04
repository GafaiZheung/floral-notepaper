import { beforeAll } from "vitest";
import { initializeI18n } from "./index";

// Polyfill browser globals for Node/Vitest environment used by renderToStaticMarkup tests.
// Components may access `window` in lazy useState initializers (e.g., window.innerWidth).
if (typeof window === "undefined") {
  (globalThis as Record<string, unknown>).window = {
    innerWidth: 1440,
    innerHeight: 900,
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
    matchMedia: () =>
      ({
        matches: false,
        media: "",
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => true,
      }) as MediaQueryList,
    requestAnimationFrame: (cb: FrameRequestCallback) => setTimeout(cb, 16) as unknown as number,
    cancelAnimationFrame: (id: number) => clearTimeout(id),
    getComputedStyle: () =>
      ({
        getPropertyValue: () => "",
      }) as unknown as CSSStyleDeclaration,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    navigator: {
      userAgent: "vitest",
      platform: "Win32",
    },
    location: {
      search: "",
      href: "http://localhost/",
      pathname: "/",
      hash: "",
      host: "localhost",
      hostname: "localhost",
      origin: "http://localhost",
      port: "",
      protocol: "http:",
      assign: () => {},
      reload: () => {},
      replace: () => {},
    },
  } as unknown as Window & typeof globalThis;
}

beforeAll(async () => {
  await initializeI18n("zh-CN");
});
