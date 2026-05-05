// tools.js — Tool implementations for the AI Agent CLI
// Two core tools: fetchWebpage (smart scraper) and createFile (write output)

import fs from "fs/promises";
import path from "path";
import puppeteer from "puppeteer";

/**
 * fetchWebpage(url)
 * ─────────────────
 * Uses Puppeteer to load a real browser page so JavaScript-rendered content
 * is captured. Returns a structured object with:
 *   - pageTitle        : the <title> tag
 *   - metaDescription  : the <meta name="description"> content
 *   - headings         : all h1–h6 text (for layout structure)
 *   - links            : anchor texts + hrefs (for nav/footer reconstruction)
 *   - bodyText         : visible text content (real copy, no Lorem Ipsum)
 *   - cssHints         : extracted colors, fonts, backgrounds from computed styles
 *   - classFrequencies : top CSS class names by usage count (design system clues)
 */
export async function fetchWebpage(url) {
  console.log(`\n   🌐 Launching browser to scrape: ${url}`);

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: "new",
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const page = await browser.newPage();

    // Set a realistic viewport and user-agent
    await page.setViewport({ width: 1440, height: 900 });
    await page.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );

    // Navigate and wait for network idle so SPAs finish rendering
    await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });

    // Extract all the structured data we need from the live page
    const scrapedData = await page.evaluate(() => {
      // ── Page meta ──
      const pageTitle = document.title || "";
      const metaTag = document.querySelector('meta[name="description"]');
      const metaDescription = metaTag ? metaTag.content : "";

      // ── Headings (layout skeleton) ──
      const headings = [];
      document.querySelectorAll("h1, h2, h3, h4, h5, h6").forEach((h) => {
        const text = h.innerText.trim();
        if (text) headings.push({ tag: h.tagName.toLowerCase(), text });
      });

      // ── Navigation & footer links ──
      const links = [];
      document.querySelectorAll("a").forEach((a) => {
        const text = a.innerText.trim();
        const href = a.getAttribute("href") || "";
        if (text && text.length < 100) {
          links.push({ text, href });
        }
      });
      // Deduplicate and cap at 80
      const uniqueLinks = [];
      const seen = new Set();
      for (const link of links) {
        const key = `${link.text}|${link.href}`;
        if (!seen.has(key)) {
          seen.add(key);
          uniqueLinks.push(link);
        }
        if (uniqueLinks.length >= 80) break;
      }

      // ── Visible body text (real copy from the website) ──
      // Walk the DOM and grab visible text nodes
      const textParts = [];
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        {
          acceptNode: (node) => {
            const parent = node.parentElement;
            if (!parent) return NodeFilter.FILTER_REJECT;
            const tag = parent.tagName.toLowerCase();
            if (["script", "style", "noscript", "svg"].includes(tag))
              return NodeFilter.FILTER_REJECT;
            const style = window.getComputedStyle(parent);
            if (style.display === "none" || style.visibility === "hidden")
              return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_ACCEPT;
          },
        }
      );
      let node;
      while ((node = walker.nextNode())) {
        const text = node.textContent.trim();
        if (text.length > 1) textParts.push(text);
      }
      // Join and truncate to ~8000 chars so we don't blow up context
      const bodyText = textParts.join("\n").substring(0, 8000);

      // ── CSS Design Hints ──
      // Sample key elements for their computed colors, fonts, backgrounds
      const cssHints = { colors: new Set(), fonts: new Set(), backgrounds: new Set() };
      const sampleSelectors = [
        "body", "header", "nav", "footer", "main",
        "h1", "h2", "h3", "p", "a", "button",
        "section", ".hero", ".header", ".footer", ".nav",
        "[class*='hero']", "[class*='header']", "[class*='banner']",
      ];
      sampleSelectors.forEach((sel) => {
        try {
          const el = document.querySelector(sel);
          if (!el) return;
          const cs = window.getComputedStyle(el);
          if (cs.color) cssHints.colors.add(cs.color);
          if (cs.backgroundColor && cs.backgroundColor !== "rgba(0, 0, 0, 0)")
            cssHints.backgrounds.add(cs.backgroundColor);
          if (cs.fontFamily) cssHints.fonts.add(cs.fontFamily.split(",")[0].trim().replace(/"/g, ""));
        } catch (_) {}
      });

      // ── Class frequency analysis (top 30) ──
      const classCounts = {};
      document.querySelectorAll("*").forEach((el) => {
        el.classList.forEach((cls) => {
          classCounts[cls] = (classCounts[cls] || 0) + 1;
        });
      });
      const classFrequencies = Object.entries(classCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 30)
        .map(([cls, count]) => ({ className: cls, count }));

      // ── Image sources (for reference only) ──
      const images = [];
      document.querySelectorAll("img").forEach((img) => {
        const src = img.src || img.getAttribute("data-src") || "";
        const alt = img.alt || "";
        if (src) images.push({ src, alt });
      });

      return {
        pageTitle,
        metaDescription,
        headings,
        links: uniqueLinks,
        bodyText,
        cssHints: {
          colors: [...cssHints.colors],
          fonts: [...cssHints.fonts],
          backgrounds: [...cssHints.backgrounds],
        },
        classFrequencies,
        images: images.slice(0, 30),
      };
    });

    await browser.close();
    console.log(`   ✅ Scrape complete — extracted ${scrapedData.headings.length} headings, ${scrapedData.links.length} links\n`);
    return JSON.stringify(scrapedData, null, 2);

  } catch (err) {
    if (browser) await browser.close();
    console.error(`   ❌ Scrape failed: ${err.message}\n`);
    return JSON.stringify({
      error: `Failed to scrape ${url}: ${err.message}`,
    });
  }
}

/**
 * createFile(filePath, content)
 * ─────────────────────────────
 * Writes content to a file on disk. Creates parent directories if needed.
 * The AI passes the raw HTML/CSS string — no escaping gymnastics required
 * because Gemini handles large JSON payloads natively.
 */
export async function createFile(filePath, content) {
  try {
    const resolvedPath = path.resolve(filePath);
    const dir = path.dirname(resolvedPath);

    // Ensure the directory exists
    await fs.mkdir(dir, { recursive: true });

    // Write the file
    await fs.writeFile(resolvedPath, content, "utf-8");

    const stats = await fs.stat(resolvedPath);
    console.log(`   📄 Created: ${resolvedPath} (${stats.size} bytes)\n`);

    return `File successfully created at ${resolvedPath} (${stats.size} bytes)`;
  } catch (err) {
    console.error(`   ❌ File creation failed: ${err.message}\n`);
    return `Error creating file: ${err.message}`;
  }
}

// Tool registry — maps tool names to their functions and metadata
export const TOOL_MAP = {
  fetchWebpage: {
    fn: fetchWebpage,
    description:
      "Scrapes a webpage using a real browser. Returns page title, headings, links, visible body text, CSS color/font hints, and class frequencies. Input: { url: string }",
  },
  createFile: {
    fn: createFile,
    description:
      'Creates or overwrites a file on the local filesystem. Input: { filePath: string, content: string }. Example: createFile("output/index.html", "<html>...</html>")',
  },
};
