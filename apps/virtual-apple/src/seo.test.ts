/** @vitest-environment happy-dom */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const CANONICAL_URL = "https://metsapple.com/";
const appRoot = process.cwd();
const publicRoot = resolve(appRoot, "../../public");
const indexHtml = readFileSync(resolve(appRoot, "index.html"), "utf8");
const robotsText = readFileSync(resolve(publicRoot, "robots.txt"), "utf8");
const sitemapXml = readFileSync(resolve(publicRoot, "sitemap.xml"), "utf8");
const llmsText = readFileSync(resolve(publicRoot, "llms.txt"), "utf8");
const markdownHomepage = readFileSync(resolve(publicRoot, "index.md"), "utf8");
const manifest = JSON.parse(readFileSync(resolve(publicRoot, "site.webmanifest"), "utf8")) as Record<string, unknown>;
const headersText = readFileSync(resolve(publicRoot, "_headers"), "utf8");

function parseIndex() {
  return new DOMParser().parseFromString(indexHtml, "text/html");
}

function metaContent(document: Document, selector: string) {
  return document.querySelector<HTMLMetaElement>(selector)?.content ?? "";
}

describe("Virtual Apple discovery metadata", () => {
  it("publishes one descriptive English canonical page", () => {
    const document = parseIndex();
    const title = document.title;
    const description = metaContent(document, 'meta[name="description"]');
    const canonicalLinks = document.querySelectorAll<HTMLLinkElement>('link[rel="canonical"]');

    expect(document.documentElement.lang).toBe("en-US");
    expect(title).toContain("Virtual Mets Apple");
    expect(title.length).toBeLessThanOrEqual(60);
    expect(description).toContain("New York Mets");
    expect(description.length).toBeGreaterThanOrEqual(120);
    expect(description.length).toBeLessThanOrEqual(160);
    expect(canonicalLinks).toHaveLength(1);
    expect(canonicalLinks[0]?.href).toBe(CANONICAL_URL);
    expect(metaContent(document, 'meta[name="robots"]')).toContain("index");
  });

  it("provides complete social previews with meaningful image text", () => {
    const document = parseIndex();

    expect(metaContent(document, 'meta[property="og:url"]')).toBe(CANONICAL_URL);
    expect(metaContent(document, 'meta[property="og:title"]')).toContain("Virtual Mets Apple");
    expect(metaContent(document, 'meta[property="og:description"]')).toContain("Home Run Apple");
    expect(metaContent(document, 'meta[property="og:image"]')).toMatch(/^https:\/\//);
    expect(metaContent(document, 'meta[property="og:image:alt"]')).toContain("red apple");
    expect(metaContent(document, 'meta[name="twitter:card"]')).toBe("summary");
    expect(metaContent(document, 'meta[name="twitter:image:alt"]')).not.toBe("");
  });

  it("describes the site and web app with valid JSON-LD", () => {
    const document = parseIndex();
    const source = document.querySelector('script[type="application/ld+json"]')?.textContent;
    const structuredData = JSON.parse(source ?? "{}") as {
      "@graph"?: Array<Record<string, unknown>>;
    };
    const graph = structuredData["@graph"] ?? [];
    const website = graph.find((entry) => entry["@type"] === "WebSite");
    const application = graph.find((entry) => entry["@type"] === "WebApplication");

    expect(website).toMatchObject({
      name: "Virtual Mets Apple",
      url: CANONICAL_URL,
      inLanguage: "en-US",
      isAccessibleForFree: true,
    });
    expect(application).toMatchObject({
      name: "Virtual Mets Apple",
      url: CANONICAL_URL,
      inLanguage: "en-US",
      isAccessibleForFree: true,
    });
  });

  it("leaves useful, equivalent content when JavaScript cannot run", () => {
    const document = parseIndex();
    const fallback = document.querySelector("#root > main");

    expect(fallback?.querySelector("h1")?.textContent).toBe("Virtual Mets Apple");
    expect(fallback?.textContent).toContain("live scores");
    expect(fallback?.textContent).toContain("unofficial fan-made experience");
    expect(fallback?.querySelector('a[href*="github.com/donth77/mets-home-run-apple"]')).not.toBeNull();
  });

  it("serves standard crawler files and a concise LLM-readable alternative", () => {
    expect(robotsText).toContain("User-agent: *");
    expect(robotsText).toContain("Allow: /");
    expect(robotsText).toContain(`Sitemap: ${CANONICAL_URL}sitemap.xml`);
    expect(sitemapXml).toContain(`<loc>${CANONICAL_URL}</loc>`);
    expect(llmsText.startsWith("# Virtual Mets Apple\n\n> ")).toBe(true);
    expect(llmsText).toContain(`[Virtual Mets Apple](${CANONICAL_URL})`);
    expect(llmsText).toContain("not affiliated");
    expect(markdownHomepage.startsWith("# Virtual Mets Apple\n")).toBe(true);
    expect(markdownHomepage).toContain("## Live data");
    expect(headersText).toContain("/sitemap.xml");
    expect(headersText).toContain("Content-Type: application/xml; charset=utf-8");
  });

  it("provides an English web-app manifest", () => {
    expect(manifest).toMatchObject({
      id: "/",
      name: "Virtual Mets Apple",
      lang: "en-US",
      start_url: "/",
      scope: "/",
      theme_color: "#081827",
    });
    expect(manifest.icons).toEqual([
      {
        src: "/favicon.png",
        sizes: "256x256",
        type: "image/png",
        purpose: "any",
      },
    ]);
  });
});
