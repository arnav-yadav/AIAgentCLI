// index.js — AI Agent CLI Tool (Gemini Rebuild)
// Conversational agentic loop: START → THINK → TOOL → OBSERVE → OUTPUT
// Uses Gemini 2.5 Flash via the @google/genai SDK

import "dotenv/config";
import readline from "readline";
import chalk from "chalk";
import ora from "ora";
import { GoogleGenAI } from "@google/genai";
import { TOOL_MAP } from "./tools.js";

// ─────────────────────────────────────────────────
// 1. CONFIGURATION
// ─────────────────────────────────────────────────

// Load all available GEMINI_API_KEYs (e.g., GEMINI_API_KEY, GEMINI_API_KEY_1, etc.)
const apiKeys = Object.keys(process.env)
  .filter(key => key.startsWith("GEMINI_API_KEY") && process.env[key] && process.env[key] !== "your_key_here")
  .map(key => process.env[key]);

if (apiKeys.length === 0) {
  console.error(
    chalk.red.bold("\n❌ Missing GEMINI_API_KEY!\n") +
    chalk.yellow(
      "   1. Go to https://aistudio.google.com/apikey\n" +
      "   2. Create a free API key\n" +
      '   3. Add it to your .env file:  GEMINI_API_KEY=your_key_here\n' +
      '   (Tip: You can add multiple keys like GEMINI_API_KEY_1, GEMINI_API_KEY_2 for auto-rotation)\n'
    )
  );
  process.exit(1);
}

let currentKeyIndex = 0;
let ai = new GoogleGenAI({ apiKey: apiKeys[currentKeyIndex] });

function rotateApiKey() {
  currentKeyIndex = (currentKeyIndex + 1) % apiKeys.length;
  ai = new GoogleGenAI({ apiKey: apiKeys[currentKeyIndex] });
  console.log(chalk.cyan(`   🔄 Switched to API Key #${currentKeyIndex + 1} of ${apiKeys.length}`));
}
const MODEL = "gemini-2.5-flash";

// ─────────────────────────────────────────────────
// 2. SYSTEM PROMPT — the brain of the agent
// ─────────────────────────────────────────────────

const SYSTEM_PROMPT = `
You are an expert AI Web Cloning Agent running inside a CLI terminal.
You follow a strict agentic loop: START → THINK → TOOL → OBSERVE → OUTPUT.

═══════════════════════════════════
YOUR TOOLS (you may ONLY use these)
═══════════════════════════════════

1. fetchWebpage(url: string)
   → Scrapes a live webpage using a real headless browser.
   → Returns: page title, all headings (h1–h6), navigation links, visible body text,
     CSS design hints (colors, fonts, backgrounds), top CSS class names by frequency,
     and image references.
   → Use this FIRST to understand the target website's layout, design system, and real content.

2. createFile(filePath: string, content: string)
   → Writes a file to the local filesystem. Creates directories automatically.
   → Use this to output index.html, style.css, or any other generated files.
   → The content parameter should be the FULL, COMPLETE file content as a raw string.

═══════════════════════════════════
STRICT RULES
═══════════════════════════════════

1. RESPONSE FORMAT: You MUST respond with EXACTLY ONE valid JSON object per message.
   The JSON schema is:
   {
     "step": "START" | "THINK" | "TOOL" | "OBSERVE" | "OUTPUT",
     "content": "string — your reasoning, observation, or final answer",
     "tool_name": "string — only when step is TOOL",
     "tool_args": { } — only when step is TOOL, an object with named arguments
   }

2. ONE STEP AT A TIME: Each response is exactly ONE step. Never combine multiple steps.

3. THINK BEFORE ACTING: Always do at least 2 THINK steps before any TOOL call.
   Plan your approach, reason about what data you need, then act.

4. AFTER EVERY TOOL CALL: Stop and wait. You will receive an OBSERVE message with the
   tool's result. Read it carefully before your next THINK step.

5. NO HALLUCINATED TOOLS: You may ONLY call fetchWebpage and createFile.
   Do NOT invent tools like "executeCommand", "runShell", "wget", "curl", "puppeteer",
   "screenshot", "downloadImage", or anything else. If you need data from a website,
   use fetchWebpage. If you need to write a file, use createFile.

6. REAL CONTENT ONLY: When cloning a website, you MUST use the ACTUAL text, headings,
   and link labels extracted from the scrape. NEVER use placeholder text like
   "Lorem ipsum", "Your Company", "Sample text", or "[Insert text here]".
   Every piece of text in your output must come from the scraped data.

7. DESIGN FIDELITY: Use the CSS hints (colors, fonts, backgrounds) from the scrape
   to match the original website's design system. Do not guess colors — use the
   extracted values.

8. COMPLETE FILES: When creating HTML/CSS, output FULL, production-ready files.
   Do not use shorthand like "/* ... rest of styles ... */" or "<!-- more content -->".
   Every file must be complete and functional.

9. MULTIPLE TOOL CALLS: You will likely need to call createFile multiple times
   (e.g., once for index.html, once for style.css). That is expected and correct.

10. WHEN DONE: End with a step of type "OUTPUT" summarizing what you created and
    how the user can view it (e.g., "Open output/index.html in your browser").

═══════════════════════════════════
EXAMPLE FLOW
═══════════════════════════════════

User: "Clone scaler.com"

{"step":"START","content":"The user wants me to clone scaler.com. I will scrape the website first to understand its layout, content, and design system."}
{"step":"THINK","content":"I need to use fetchWebpage to get the real content and CSS hints from scaler.com. This will give me headings, nav links, body text, colors, and fonts."}
{"step":"THINK","content":"After scraping, I will analyze the data to identify the header, hero section, and footer. Then I will generate index.html and style.css using the real content and extracted design tokens."}
{"step":"TOOL","tool_name":"fetchWebpage","tool_args":{"url":"https://www.scaler.com"}}
[OBSERVE step arrives with scraped data]
{"step":"THINK","content":"I received the scrape data. The primary colors are X, Y, Z. The font is 'Inter'. I can see the header has these nav links... The hero section says... The footer contains..."}
{"step":"THINK","content":"Now I will construct a complete index.html with the real header, hero, and footer content. I will use the extracted CSS values for styling."}
{"step":"TOOL","tool_name":"createFile","tool_args":{"filePath":"output/index.html","content":"<!DOCTYPE html>..."}}
[OBSERVE step arrives confirming file creation]
{"step":"TOOL","tool_name":"createFile","tool_args":{"filePath":"output/style.css","content":"* { margin: 0; ... }"}}
[OBSERVE step arrives confirming file creation]
{"step":"OUTPUT","content":"Done! I have created output/index.html and output/style.css. Open output/index.html in your browser to see the cloned Scaler website."}
`;

// ─────────────────────────────────────────────────
// 3. CONVERSATION STATE
// ─────────────────────────────────────────────────

// Gemini uses a flat contents array with role: "user" | "model"
// We inject the system prompt as the systemInstruction config.
let conversationHistory = [];

// ─────────────────────────────────────────────────
// 4. GEMINI API CALL
// ─────────────────────────────────────────────────

async function callGemini() {
  const response = await ai.models.generateContent({
    model: MODEL,
    contents: conversationHistory,
    config: {
      systemInstruction: SYSTEM_PROMPT,
      responseMimeType: "application/json",
      temperature: 0.2,
    },
  });

  const text = response.text.trim();
  return text;
}

// ─────────────────────────────────────────────────
// 5. PARSE + EXECUTE ONE AGENT STEP
// ─────────────────────────────────────────────────

async function executeAgentStep(parsed) {
  const step = parsed.step;

  switch (step) {
    case "START":
      console.log(chalk.cyan.bold("\n🚀 START ") + chalk.cyan(parsed.content));
      break;

    case "THINK":
      console.log(chalk.magenta.bold("💭 THINK ") + chalk.magenta(parsed.content));
      break;

    case "TOOL": {
      const toolName = parsed.tool_name;
      const toolArgs = parsed.tool_args || {};
      console.log(
        chalk.yellow.bold(`\n🔧 TOOL → ${toolName}`) +
        chalk.gray(` (${JSON.stringify(toolArgs)})`)
      );

      const toolEntry = TOOL_MAP[toolName];
      if (!toolEntry) {
        // Tool not found — feed an error back as an OBSERVE
        const errMsg = `Tool "${toolName}" does not exist. Available tools: ${Object.keys(TOOL_MAP).join(", ")}`;
        console.log(chalk.red(`   ⚠ ${errMsg}`));
        return {
          step: "OBSERVE",
          content: errMsg,
        };
      }

      // Execute the tool with the right arguments
      const spinner = ora({ text: `Running ${toolName}...`, color: "yellow" }).start();
      let result;
      try {
        if (toolName === "fetchWebpage") {
          result = await toolEntry.fn(toolArgs.url);
        } else if (toolName === "createFile") {
          result = await toolEntry.fn(toolArgs.filePath, toolArgs.content);
        } else {
          result = "Unknown tool argument mapping.";
        }
        spinner.succeed(`${toolName} completed`);
      } catch (err) {
        spinner.fail(`${toolName} failed`);
        result = `Tool error: ${err.message}`;
      }

      return {
        step: "OBSERVE",
        content: typeof result === "string" ? result : JSON.stringify(result),
      };
    }

    case "OBSERVE":
      // This shouldn't happen from the model, but just in case
      console.log(chalk.blue.bold("👁 OBSERVE ") + chalk.blue(parsed.content?.substring(0, 200) + "..."));
      break;

    case "OUTPUT":
      console.log(chalk.green.bold("\n✅ OUTPUT ") + chalk.green(parsed.content));
      return null; // Signal to stop the loop

    default:
      console.log(chalk.gray(`   [Unknown step: ${step}] ${parsed.content || ""}`));
  }

  return undefined; // Continue the loop
}

// ─────────────────────────────────────────────────
// 6. AGENT LOOP — runs until OUTPUT
// ─────────────────────────────────────────────────

async function runAgentLoop() {
  const MAX_ITERATIONS = 30; // Safety cap to prevent infinite loops

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const spinner = ora({ text: "Agent is thinking...", color: "cyan" }).start();

    let rawText;
    try {
      rawText = await callGemini();
      spinner.stop();
    } catch (err) {
      spinner.fail("Gemini API call failed");
      console.error(chalk.red(`   Error: ${err.message}`));

      // If rate limited, service unavailable, or key is expired/invalid, rotate and retry
      if (
        err.message?.includes("429") ||
        err.message?.includes("quota") ||
        err.message?.includes("503") ||
        err.message?.includes("UNAVAILABLE") ||
        err.message?.includes("high demand") ||
        err.message?.includes("400") ||
        err.message?.includes("expired") ||
        err.message?.includes("API_KEY_INVALID") ||
        err.message?.includes("403") ||
        err.message?.includes("PERMISSION_DENIED")
      ) {
        if (apiKeys.length > 1) {
          rotateApiKey();

          if (currentKeyIndex === 0) {
            console.log(chalk.yellow("   ⏳ All keys are rate limited or busy. Waiting 10 seconds..."));
            await new Promise((r) => setTimeout(r, 10000));
          } else {
            // Small delay to prevent console spamming
            await new Promise((r) => setTimeout(r, 1500));
          }

          i--; // Don't count API errors against MAX_ITERATIONS
          continue;
        }

        console.log(chalk.yellow("   ⏳ Service busy or rate limited. Waiting 10 seconds..."));
        await new Promise((r) => setTimeout(r, 10000));
        i--; // Don't count API errors against MAX_ITERATIONS
        continue;
      }
      break;
    }

    // Parse the JSON response
    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch (parseErr) {
      console.error(chalk.red("   ❌ Failed to parse JSON from model:"));
      console.error(chalk.gray(`   Raw: ${rawText.substring(0, 300)}`));

      // Push a correction hint and retry
      conversationHistory.push({
        role: "model",
        parts: [{ text: rawText }],
      });
      conversationHistory.push({
        role: "user",
        parts: [
          {
            text: JSON.stringify({
              step: "OBSERVE",
              content:
                "Your last response was not valid JSON. Please respond with EXACTLY one JSON object following the schema: {step, content, tool_name?, tool_args?}",
            }),
          },
        ],
      });
      continue;
    }

    // Add model response to history
    conversationHistory.push({
      role: "model",
      parts: [{ text: rawText }],
    });

    // Execute the step
    const result = await executeAgentStep(parsed);

    if (result === null) {
      // OUTPUT step — we're done
      return;
    }

    if (result && result.step === "OBSERVE") {
      // Tool produced an observation — feed it back
      console.log(
        chalk.blue.bold("👁 OBSERVE ") +
        chalk.blue(result.content.substring(0, 200) + (result.content.length > 200 ? "..." : ""))
      );
      conversationHistory.push({
        role: "user",
        parts: [{ text: JSON.stringify(result) }],
      });
    }
  }
}

// ─────────────────────────────────────────────────
// 7. READLINE INTERFACE — continuous chat
// ─────────────────────────────────────────────────

async function main() {
  console.log(
    chalk.cyan.bold(`
╔══════════════════════════════════════════════════╗
║           🤖 AI Agent CLI (Gemini)               ║
║                                                  ║
║  Conversational AI that clones websites.         ║
║  Type your instruction and press Enter.          ║
║  Type "exit" or "quit" to leave.                 ║
╚══════════════════════════════════════════════════╝
`)
  );

  console.log(chalk.gray(`  Model:  ${MODEL}`));
  console.log(chalk.gray(`  Tools:  ${Object.keys(TOOL_MAP).join(", ")}`));
  console.log(chalk.gray(`  Tip:    Try "Clone scaler.com"\n`));

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const prompt = () => {
    rl.question(chalk.white.bold("You → "), async (userInput) => {
      const trimmed = userInput.trim();

      if (!trimmed) {
        prompt();
        return;
      }

      if (["exit", "quit", "q"].includes(trimmed.toLowerCase())) {
        console.log(chalk.cyan("\n👋 Goodbye!\n"));
        rl.close();
        process.exit(0);
      }

      // Add user message to conversation history
      conversationHistory.push({
        role: "user",
        parts: [{ text: trimmed }],
      });

      console.log(chalk.gray("\n─".repeat(50)));

      // Run the agent loop until it produces an OUTPUT
      await runAgentLoop();

      console.log(chalk.gray("─".repeat(50) + "\n"));

      // Continue prompting
      prompt();
    });
  };

  prompt();
}

main();
