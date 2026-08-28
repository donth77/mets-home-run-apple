/** @vitest-environment happy-dom */

import { describe, expect, it } from "vitest";
import { documentPictureInPictureSupported, prepareMiniAppleDocument } from "./useMiniAppleWindow";

describe("Mini Apple document setup", () => {
  it("detects Document Picture-in-Picture without assuming every browser supports it", () => {
    expect(documentPictureInPictureSupported(undefined)).toBe(false);
    expect(documentPictureInPictureSupported({} as Window)).toBe(false);
    expect(
      documentPictureInPictureSupported({ documentPictureInPicture: { requestWindow: async () => window } } as never),
    ).toBe(true);
  });

  it("copies app styles and creates an isolated portal root", () => {
    const source = document.implementation.createHTMLDocument("Virtual Apple");
    source.documentElement.lang = "en-US";
    const stylesheet = source.createElement("link");
    stylesheet.rel = "stylesheet";
    stylesheet.href = "data:text/css,.linked%7Bcolor%3Ablue%7D";
    source.head.append(stylesheet);
    const inlineStyle = source.createElement("style");
    inlineStyle.textContent = ".test { color: orange; }";
    source.head.append(inlineStyle);

    const target = document.implementation.createHTMLDocument("");
    target.body.append(target.createElement("p"));
    const root = prepareMiniAppleDocument(source, target);

    expect(target.title).toBe("Mini Virtual Mets Apple");
    expect(target.documentElement.lang).toBe("en-US");
    expect(target.documentElement.className).toBe("mini-apple-document-root");
    expect(target.body.className).toBe("mini-apple-document");
    expect(target.body.children).toHaveLength(1);
    expect(root.id).toBe("mini-apple-root");
    expect(target.querySelector('link[rel="stylesheet"]')?.getAttribute("href")).toBe(
      "data:text/css,.linked%7Bcolor%3Ablue%7D",
    );
    expect(target.querySelector("style")?.textContent).toContain("color: orange");
  });
});
