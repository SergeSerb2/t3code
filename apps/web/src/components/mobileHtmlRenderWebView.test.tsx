// @vitest-environment jsdom

import { act, type ComponentType, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

// The mobile workspace uses a newer React copy; keep this unit renderer on one React instance.
vi.mock("../../../mobile/node_modules/react/index.js", async () => await import("react"));
const load = vi.hoisted(() => vi.fn());
vi.mock("@t3tools/shared/htmlRender", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  loadRestrictedHtmlRender: load,
}));
vi.mock("../../../mobile/node_modules/@react-navigation/native/lib/module/index.js", () => ({
  useNavigation: () => ({}),
}));
vi.mock("../../../mobile/node_modules/react-native/index.js", () => ({
  ActivityIndicator: () => <span data-testid="spinner" />,
  View: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Pressable: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Platform: { OS: "ios" },
}));
vi.mock("../../../mobile/node_modules/react-native-webview/index.js", () => ({
  WebView: ({ source }: { source: { html: string } }) => (
    <div data-testid="page">{source.html}</div>
  ),
}));
vi.mock("../../../mobile/src/components/AppSymbol", () => ({ SymbolView: () => null }));
vi.mock("../../../mobile/src/components/AppText", () => ({
  AppText: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));
vi.mock("../../../mobile/src/components/EmptyState", () => ({
  EmptyState: ({
    title,
    actionLabel,
    onAction,
  }: {
    title: string;
    actionLabel: string;
    onAction?: () => void;
  }) => (
    <div>
      <span>{title}</span>
      <button onClick={onAction}>{actionLabel}</button>
    </div>
  ),
}));
vi.mock("../../../mobile/src/lib/htmlRenderTheme", () => ({
  mobileHtmlRenderTheme: () => ({ variables: { "--background": "white" } }),
}));
vi.mock("../../../mobile/src/lib/openExternalUrl", () => ({ tryOpenExternalUrl: vi.fn() }));
vi.mock("../../../mobile/src/state/assets", () => ({
  useAssetUrlState: vi.fn(),
  useRefreshAssetUrl: vi.fn(),
}));
vi.mock("../../../mobile/src/features/settings/appearance/AppearancePreferencesProvider", () => ({
  useAppearancePreferences: () => ({}),
}));

// Keep native platform declarations out of the web TypeScript project; the unit harness mocks them.
const mobileModule = "../../../mobile/src/features/threads/HtmlRenderWebView.tsx";
const HtmlRenderWebView = (await import(mobileModule)).HtmlRenderWebView as ComponentType<{
  uri: string;
  title: string;
  nested: boolean;
  onLoadError?: () => void;
  onRetry?: () => void;
}>;

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  load.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("mobile HTML request lifecycle", () => {
  it("keeps an in-flight download across parent callbacks and reports to the latest callback", async () => {
    let reject!: (error: Error) => void;
    load.mockImplementation(
      () =>
        new Promise<string>((_resolve, fail) => {
          reject = fail;
        }),
    );
    const first = vi.fn();
    const latest = vi.fn();
    await act(async () =>
      root.render(
        <HtmlRenderWebView uri="https://asset/page" title="Page" nested onLoadError={first} />,
      ),
    );
    const signal = load.mock.calls[0]![1] as AbortSignal;
    await act(async () =>
      root.render(
        <HtmlRenderWebView uri="https://asset/page" title="Page" nested onLoadError={latest} />,
      ),
    );
    expect(load).toHaveBeenCalledTimes(1);
    expect(signal.aborted).toBe(false);
    await act(async () => reject(new Error("connection dropped")));
    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledOnce();
  });
  it("aborts on a new URL and prevents the old request from showing a page", async () => {
    let resolve!: (html: string) => void;
    load.mockImplementationOnce(
      () =>
        new Promise<string>((done) => {
          resolve = done;
        }),
    );
    load.mockResolvedValueOnce("new page");
    await act(async () =>
      root.render(<HtmlRenderWebView uri="https://asset/old" title="Page" nested />),
    );
    const signal = load.mock.calls[0]![1] as AbortSignal;
    await act(async () =>
      root.render(<HtmlRenderWebView uri="https://asset/new" title="Page" nested />),
    );
    await act(async () => resolve("old page"));
    expect(signal.aborted).toBe(true);
    expect(load).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[data-testid="page"]')?.textContent).toBe("new page");
  });
  it("replaces the full-screen spinner with an error and reauthorizes on retry", async () => {
    load.mockRejectedValueOnce(new Error("expired asset URL"));
    load.mockResolvedValueOnce("recovered page");
    const retry = vi.fn(() =>
      root.render(
        <HtmlRenderWebView key="retry" uri="https://asset/fresh" title="Page" nested={false} />,
      ),
    );
    await act(async () =>
      root.render(
        <HtmlRenderWebView
          key="initial"
          uri="https://asset/expired"
          title="Page"
          nested={false}
          onRetry={retry}
        />,
      ),
    );
    expect(container.textContent).toContain("File unavailable");
    expect(container.querySelector('[data-testid="spinner"]')).toBeNull();
    await act(async () => container.querySelector("button")!.click());
    expect(retry).toHaveBeenCalledOnce();
    expect(load).toHaveBeenLastCalledWith("https://asset/fresh", expect.any(AbortSignal));
    expect(container.querySelector('[data-testid="page"]')?.textContent).toBe("recovered page");
  });
});
