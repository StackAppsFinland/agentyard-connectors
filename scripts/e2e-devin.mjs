// End-to-end check of DevinConnector against the real local Devin install.
// Run: npm run build && node scripts/e2e-devin.mjs
// Exercises: listTabs -> createTab -> postToTab (streamed) -> readTab -> deleteTab.
import { DevinConnector } from "../dist/index.js";

const CWD = "C:\\Code\\Stackapps\\agentyard-connectors";
const conn = await DevinConnector.connect({ cwd: CWD, loadDrainMs: 200 });

try {
  console.log("== capabilities ==", JSON.stringify(conn.capabilities()));

  console.log("\n== listTabs (before) ==");
  const before = await conn.listTabs();
  for (const t of before) console.log(`  ${t.sessionId}  ${t.isLocked ? "[locked]" : ""}  ${t.title ?? ""}`);

  // clean up leftover probe session if present
  const stale = before.find((t) => t.sessionId === "curse-pearl");
  if (stale) {
    console.log("\n== deleting leftover probe session curse-pearl ==");
    await conn.deleteTab("curse-pearl");
  }

  console.log("\n== createTab ==");
  const tab = await conn.createTab(CWD);
  console.log("  created:", tab.sessionId);

  console.log("\n== postToTab ==");
  let text = "";
  for await (const e of conn.postToTab(tab.sessionId, "Reply with exactly the words: AgentYard connector OK")) {
    if (e.type === "text") {
      text += e.text;
      process.stdout.write(e.text);
    } else if (e.type === "thought") {
      process.stdout.write(`\n  [thought] ${e.text.slice(0, 100)}`);
    } else if (e.type === "tool_call") {
      process.stdout.write(`\n  [tool] ${e.toolCall.title ?? e.toolCall.toolCallId}`);
    } else if (e.type === "done") {
      console.log(`\n  done: ${e.stopReason}`);
    }
  }
  console.log("  agent text:", JSON.stringify(text.slice(0, 300)));

  console.log("\n== readTab ==");
  const transcript = await conn.readTab(tab.sessionId);
  for (const e of transcript.entries.slice(0, 10)) {
    console.log(`  [${e.kind}] ${(e.text ?? e.toolCall?.title ?? "").slice(0, 120)}`);
  }

  console.log("\n== deleteTab ==");
  await conn.deleteTab(tab.sessionId);
  const after = await conn.listTabs();
  console.log("  still present?", after.some((t) => t.sessionId === tab.sessionId));

  console.log("\nE2E PASSED");
} finally {
  conn.close();
}
