import { describe, expect, it, vi } from "vite-plus/test";

import {
  loadRestrictedHtmlRender,
  initializeHtmlRenderTheme,
  htmlRenderFrameHeight,
  htmlRenderReferencesEqual,
  htmlRenderTheme,
  htmlRenderThemeFragment,
  injectHtmlRenderBootstrap,
  htmlRenderThemeMessage,
  readHtmlRenderLinkRequest,
  readHtmlRenderReference,
} from "./htmlRender.ts";
import { T3_CODE_DARK_THEME_COLORS, T3_CODE_LIGHT_THEME_COLORS } from "./themePalettes.ts";
import { htmlRenderFromToolItem } from "./toolOutput.ts";

const reference = { attachmentId: "thread-abc-123.html", title: "Chart", height: 420 };

describe("injectHtmlRenderBootstrap", () => {
  it("establishes resource restrictions before an executable prefix and blocks all network resource types", () => {
    const injected = injectHtmlRenderBootstrap(
      '<script>fetch("http://192.168.1.1/")</script><head></head>',
    );
    expect(injected.indexOf('http-equiv="Content-Security-Policy"')).toBeLessThan(
      injected.indexOf("<script>fetch"),
    );
    for (const directive of [
      "default-src 'none'",
      "connect-src 'none'",
      "frame-src 'none'",
      "form-action 'none'",
      "img-src data: blob:",
    ])
      expect(injected).toContain(directive);
  });
  it("puts the theme ahead of the page's own head content", () => {
    const html =
      "<!doctype html><html><head><style>:root{--background:red}</style></head><body>x</body></html>";
    const injected = injectHtmlRenderBootstrap(html);
    const themeAt = injected.indexOf('<style id="t3-theme">');
    expect(themeAt).toBeGreaterThan(injected.indexOf("<head>"));
    expect(themeAt).toBeLessThan(injected.indexOf(":root{--background:red}"));
    expect(injected).toContain('<meta charset="utf-8">');
    expect(injected).toContain('name="viewport"');
  });

  it("wraps fragments without a head and keeps existing meta tags", () => {
    const fragment =
      '<meta charset="utf-8"><meta name="viewport" content="width=device-width"><p>hi</p>';
    const injected = injectHtmlRenderBootstrap(fragment);
    expect(injected.startsWith('<!doctype html><meta http-equiv="Content-Security-Policy"')).toBe(
      true,
    );
    expect(injected.match(/charset/g)).toHaveLength(1);
    expect(injected.match(/name="viewport"/g)).toHaveLength(1);
    expect(injected.endsWith("<p>hi</p>")).toBe(true);
  });

  it.each(["textarea", "title", "xmp", "iframe", "noembed", "noframes", "noscript", "plaintext"])(
    "keeps the bootstrap outside %s content",
    (tag) => {
      const fragment = `<${tag}><head><meta name="viewport"></head></${tag}>`;
      const injected = injectHtmlRenderBootstrap(fragment);
      expect(injected.startsWith('<!doctype html><meta http-equiv="Content-Security-Policy"')).toBe(
        true,
      );
      expect(injected.indexOf('<style id="t3-theme">')).toBeLessThan(injected.indexOf(`<${tag}>`));
      expect(injected).toContain('<meta name="viewport" content="width=device-width');
      expect(injected.endsWith(fragment)).toBe(true);
    },
  );

  it.each([
    '<template><head><meta name="viewport"></head></template>',
    '<template><template>inner</template><head><meta name="viewport"></head></template>',
  ])("keeps the bootstrap outside inert template content: %s", (fragment) => {
    const injected = injectHtmlRenderBootstrap(fragment);
    expect(injected.startsWith('<!doctype html><meta http-equiv="Content-Security-Policy"')).toBe(
      true,
    );
    expect(injected.indexOf('<style id="t3-theme">')).toBeLessThan(injected.indexOf("<template>"));
    expect(injected).toContain('<meta name="viewport" content="width=device-width');
    expect(injected.endsWith(fragment)).toBe(true);
  });

  it("ignores tags written inside comments and scripts", () => {
    const html =
      '<!-- copy <head> and <meta name="viewport"> here --><html><head>' +
      "<script>const tag = '<meta name=\"viewport\">';</script></head><body>x</body></html>";
    const injected = injectHtmlRenderBootstrap(html);
    expect(injected.indexOf('<style id="t3-theme">')).toBeGreaterThan(
      injected.indexOf("<html><head>"),
    );
    expect(injected).toContain('<meta name="viewport" content="width=device-width');
  });
});

describe("readHtmlRenderLinkRequest", () => {
  it("accepts only http(s) URLs in an MCP Apps ui/open-link request", () => {
    const link = (url: unknown) => ({
      jsonrpc: "2.0",
      id: 1,
      method: "ui/open-link",
      params: { url },
    });
    expect(readHtmlRenderLinkRequest(link("https://example.com/a"))).toEqual({
      id: 1,
      url: "https://example.com/a",
    });
    expect(readHtmlRenderLinkRequest(link("javascript:alert(1)"))).toBeUndefined();
    expect(readHtmlRenderLinkRequest(link("file:///etc/passwd"))).toBeUndefined();
    expect(
      readHtmlRenderLinkRequest({
        jsonrpc: "2.0",
        method: "ui/open-link",
        params: { url: "https://example.com" },
      }),
    ).toBeUndefined();
    expect(
      readHtmlRenderLinkRequest({ type: "t3-html-render-link", url: "https://example.com" }),
    ).toBeUndefined();
  });
});

describe("htmlRenderThemeMessage", () => {
  it("is an MCP Apps host-context-changed notification carrying the theme variables", () => {
    const theme = htmlRenderTheme(T3_CODE_DARK_THEME_COLORS, "dark");
    expect(htmlRenderThemeMessage(theme)).toEqual({
      jsonrpc: "2.0",
      method: "ui/notifications/host-context-changed",
      params: { theme: "dark", styles: { variables: theme.variables } },
    });
  });
});

describe("htmlRenderTheme", () => {
  it("exposes the brand accent as --accent and keeps the fragment decodable", () => {
    const theme = htmlRenderTheme(T3_CODE_LIGHT_THEME_COLORS, "light");
    expect(theme.variables["--accent"]).toBe(T3_CODE_LIGHT_THEME_COLORS.accent);
    expect(theme.variables["--chart-1"]).toBe(T3_CODE_LIGHT_THEME_COLORS.accent);
    expect(theme.variables["--chart-6"]).toBeDefined();
    const fragment = htmlRenderThemeFragment(theme);
    expect(JSON.parse(decodeURIComponent(fragment.slice("#t3-theme=".length)))).toEqual(theme);
    expect(fragment).not.toContain("&");
    expect(htmlRenderTheme(T3_CODE_DARK_THEME_COLORS, "dark").variables["--background"]).toBe(
      T3_CODE_DARK_THEME_COLORS.canvas,
    );
  });
});

describe("readHtmlRenderReference", () => {
  it("clamps height and rejects malformed references", () => {
    expect(readHtmlRenderReference({ ...reference, height: 99_999 })?.height).toBe(2000);
    expect(readHtmlRenderReference({ ...reference, title: "  " })?.title).toBe("HTML");
    expect(readHtmlRenderReference({ ...reference, attachmentId: 4 })).toBeUndefined();
    expect(readHtmlRenderReference({ ...reference, height: Number.NaN })).toBeUndefined();
  });
});

describe("htmlRenderFromToolItem", () => {
  const result = { htmlRender: reference, message: "Rendered above your reply." };

  it("reads the reference from each provider's result envelope", () => {
    for (const [toolName, output] of [
      ["mcp__t3-code__html_render", [{ type: "text", text: JSON.stringify(result) }]],
      ["t3-code.html_render", { structuredContent: result, content: [] }],
      ["t3-code-thread_1_html_render", JSON.stringify(result)],
      ["html_render", result],
    ] as const) {
      expect(htmlRenderFromToolItem({ toolName, output })).toEqual(reference);
    }
  });

  it("ignores other tools and failed calls", () => {
    expect(htmlRenderFromToolItem({ toolName: "mcp__t3-code__html_preview", output: result })).toBe(
      undefined,
    );
    expect(htmlRenderFromToolItem({ toolName: "mcp__other__html_render", output: result })).toBe(
      undefined,
    );
    expect(
      htmlRenderFromToolItem({ toolName: "html_render", output: { ...result, isError: true } }),
    ).toBeUndefined();
  });
});

describe("htmlRenderFrameHeight", () => {
  const measured = readHtmlRenderReference({
    ...reference,
    height: 1500,
    heights: [
      [728, 1403],
      [390, 1290],
      [1000, 1660],
    ],
  })!;

  it("takes the taller neighbor between measured widths and holds the ends", () => {
    expect(measured.heights?.map(([width]) => width)).toEqual([390, 728, 1000]);
    expect(htmlRenderFrameHeight(measured, 728)).toBe(1403);
    expect(htmlRenderFrameHeight(measured, 559)).toBe(1403);
    expect(htmlRenderFrameHeight(measured, 320)).toBe(1290);
  });

  it("takes the taller layout when a breakpoint falls between measured widths", () => {
    // 900px tall below a 600px media query, 450px above it.
    const responsive = readHtmlRenderReference({
      ...reference,
      height: 2000,
      heights: [
        [520, 900],
        [640, 450],
      ],
    })!;
    expect(htmlRenderFrameHeight(responsive, 590)).toBe(900);
    expect(htmlRenderFrameHeight(responsive, 640)).toBe(450);
  });

  it("never exceeds the agent's height and falls back to it without measurements", () => {
    expect(htmlRenderFrameHeight(measured, 1400)).toBe(1500);
    expect(htmlRenderFrameHeight(reference, 728)).toBe(reference.height);
  });

  it("drops a malformed table and compares tables by value", () => {
    expect(readHtmlRenderReference({ ...reference, heights: [[728, "x"]] })?.heights).toBe(
      undefined,
    );
    const copy = readHtmlRenderReference(JSON.parse(JSON.stringify(measured)))!;
    expect(htmlRenderReferencesEqual(measured, copy)).toBe(true);
    expect(htmlRenderReferencesEqual(measured, { ...copy, heights: [[390, 1290]] })).toBe(false);
  });
});

const htmlRenderFetch = vi.fn<typeof fetch>();

it("restricts older backend markup before a client can execute it", async () => {
  const markup = '<script>fetch("http://192.168.1.1/")</script><head></head>';
  vi.stubGlobal("fetch", htmlRenderFetch.mockResolvedValue(new Response(markup)));
  try {
    const html = await loadRestrictedHtmlRender(
      "https://backend.test/signed-asset",
      new AbortController().signal,
    );
    expect(html.indexOf('http-equiv="Content-Security-Policy"')).toBeLessThan(
      html.indexOf("<script>fetch"),
    );
    expect(html).toContain("connect-src 'none'");
  } finally {
    vi.unstubAllGlobals();
  }
});

it("does not hand an error response or oversized document to a client browser", async () => {
  try {
    for (const response of [
      new Response("denied", { status: 403 }),
      new Response("small", { headers: { "content-length": String(26 * 1024 * 1024) } }),
    ]) {
      vi.stubGlobal("fetch", htmlRenderFetch.mockResolvedValue(response));
      await expect(
        loadRestrictedHtmlRender("https://backend.test/signed-asset", new AbortController().signal),
      ).rejects.toBeInstanceOf(Error);
    }
  } finally {
    vi.unstubAllGlobals();
  }
});

describe("initial theme for in-memory HTML documents", () => {
  const theme = { appearance: "dark" as const, variables: { "--background": "rgb(1,2,3)" } };
  it("replaces the OS palette before document scripts and preserves page styles", () => {
    const page = injectHtmlRenderBootstrap(
      "<head><style>:root{--accent:purple}</style></head><body>Page</body>",
    );
    const themed = initializeHtmlRenderTheme(page, theme);
    expect(themed).toContain(":root{color-scheme:dark;--background:rgb(1,2,3);");
    expect(themed).toContain("<style>:root{--accent:purple}</style>");
    expect(themed).not.toContain("@media (prefers-color-scheme: light)");
    expect(themed.indexOf("--background:rgb(1,2,3)")).toBeLessThan(themed.indexOf("<script>"));
    expect(themed.indexOf("Content-Security-Policy")).toBeLessThan(themed.indexOf("<style"));
  });
  it("ignores fake theme markers in scripts, comments and inert templates", () => {
    const inert = '<template><style id="t3-theme">inert</style></template>';
    const fake = "<script>const fake = '<style id=\"t3-theme\">fake</style>';</script>";
    const page = injectHtmlRenderBootstrap("<head>" + inert + fake + "</head>");
    const themed = initializeHtmlRenderTheme(page, theme);
    expect(themed).toContain(inert);
    expect(themed).toContain(fake);
    expect(themed).toContain("--background:rgb(1,2,3)");
  });
  it("adds a safe themed bootstrap to older documents without one", () => {
    const themed = initializeHtmlRenderTheme("<body>Older page</body>", theme);
    expect(themed).toContain('id="t3-theme"');
    expect(themed).toContain("--background:rgb(1,2,3)");
    expect(themed).toContain("Content-Security-Policy");
  });
});

it("initial theme values cannot break out of their style element", () => {
  const themed = initializeHtmlRenderTheme("<body>Page</body>", {
    appearance: "light",
    variables: { "--background": "red;</style><script>bad()</script>", "invalid-key": "ignored" },
  });
  expect(themed).not.toContain("<script>bad()");
  expect(themed).not.toContain("invalid-key:");
  expect(themed).toContain("color-scheme:light");
});
