# 🤖 AI Agent CLI — Website Cloner (Gemini Rebuild)

A conversational CLI agent that takes a user's instruction (e.g., "Clone scaler.com"), autonomously scrapes the target website, and generates a fully functioning, high-fidelity replica using an agentic **START → THINK → TOOL → OBSERVE → OUTPUT** loop.

## Architecture

```
User Input → Gemini 2.5 Flash (JSON mode)
                    ↓
           START → THINK → TOOL → OBSERVE → OUTPUT
                             ↓
                  fetchWebpage() — Puppeteer scraper
                  createFile()  — writes HTML/CSS
```

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Get a Gemini API key (free)
#    → https://aistudio.google.com/apikey

# 3. Add your key to .env
echo "GEMINI_API_KEY=your_actual_key" > .env

# 4. Run the agent
node index.js
```

## Tools

| Tool | Description |
|------|-------------|
| `fetchWebpage(url)` | Headless Puppeteer scraper — extracts page text, headings, links, CSS colors/fonts/backgrounds, class frequencies |
| `createFile(filePath, content)` | Writes files to disk — used by the AI to output `index.html`, `style.css`, etc. |

## Key Design Decisions

- **Gemini 2.5 Flash** with `responseMimeType: "application/json"` — eliminates JSON parsing failures that plagued smaller models
- **1M token context** — no need for aggressive history pruning
- **Smart scraping** — CSS hints + class frequencies give the AI design system awareness, not just raw text
- **Hallucination guardrails** — system prompt explicitly locks down tool usage (no invented shell commands)
- **Real content enforcement** — prompt mandates using scraped text, never placeholders

## Example Usage

```
You → Clone scaler.com

🚀 START  The user wants me to clone scaler.com...
💭 THINK  I need to scrape the website first...
💭 THINK  After scraping, I'll analyze the layout...
🔧 TOOL → fetchWebpage ({"url":"https://www.scaler.com"})
   ✅ Scrape complete — extracted 12 headings, 45 links
👁 OBSERVE  {"pageTitle":"Scaler Academy"...}
💭 THINK  The primary colors are...
🔧 TOOL → createFile ({"filePath":"output/index.html"...})
   📄 Created: output/index.html (8234 bytes)
🔧 TOOL → createFile ({"filePath":"output/style.css"...})
   📄 Created: output/style.css (3421 bytes)
✅ OUTPUT  Done! Open output/index.html in your browser.
```
