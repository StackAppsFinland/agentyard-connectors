# AgentYard — Devin-first implementation plan

Updated: 27 October 2026. Working name; availability has not been checked.

## Purpose

Control existing Devin Desktop conversations from a phone while away from the computer. Type or dictate instructions, follow progress, answer questions, and return to completed work ready for review and testing. Projects may involve code, documents, or other work supported by the connected agent.

## Audience and product positioning

AgentYard is for people who want to direct work in an existing agent application from their phone, including developers who want a finished product rather than another integration project. Begin with the founder's real Devin workflow, then validate with other users. The interface should remain understandable for document-based and other non-coding projects as supported connectors expand.

The product promise is: install, pair, choose a conversation, and work. Public users should not need to compile software, run terminal commands, edit configuration files, open router ports, or understand connector protocols. Supply a phone app and a packaged desktop companion, with guided pairing, clear connection status, and actionable errors. Developer setup instructions may exist for contributors but are not the customer onboarding flow.

The founder sees an early market opportunity and regards friction in alternatives such as Happier as a potential differentiator. These are product hypotheses, not verified market-size or competitor-capability claims. Open-source licensing alone does not imply difficult installation. Verify current competing onboarding experiences before making public comparisons. Compete on demonstrated setup simplicity, reliable session routing, and useful conversational control.

## User experience

1. Install AgentYard on the phone and sign in.
2. Download the desktop companion from the AgentYard website, install it, and pair it with the phone using a short-lived code or QR flow.
3. The companion discovers supported applications and reports connection capabilities. Version one supports only Devin.
4. The phone home screen resembles a WhatsApp contact list. Devin is an application contact; opening it reveals its sessions as tabs.
5. Choose which tabs appear. Show, for example, only three current projects. Hiding a tab affects phone visibility only; it never closes the Devin session. Provide a hidden-session list for restoring tabs.
6. Select a tab and type or dictate an instruction. Voice and text use the same conversation and command path. Support simple navigation such as “use the first tab,” resolved against the current visible tab order.
7. Show the selected project and session clearly before sending. Bind every tab to a stable provider session identifier, never its list position. Persist tab visibility and order.
8. Receive streamed responses, progress, questions, and any provider approval requests. Keep work accessible after closing and reopening the phone app.

## Mandatory first milestone: prove existing-session access

Before building the full UI, inspect the current installed Devin version and official integration interfaces. Demonstrate all of the following with a harmless instruction:

- Discover a conversation already opened in Devin Desktop.
- Attach to that exact session without creating or copying it.
- Send a prompt and receive the response remotely.
- Confirm both appear in the same desktop conversation.
- Identify how authentication, streaming, cancellation, and approval requests work and which capabilities are actually available.

Record commands, versions, evidence, and documented versus experimental behavior. An editor sharing VS Code ancestry does not establish session access. If existing-session attachment is unsupported, report the blocker before implementing an alternative workflow. Creating new bridge-owned sessions is not acceptance of this requirement. Do not silently substitute UI automation.

## Mobile technology decision

Use React Native with TypeScript and Expo for the phone app. Share most UI and application logic across iOS and Android, while allowing platform-specific native modules where needed. Build and test separately for both platforms; microphone permissions, dictation, notifications, and lifecycle behavior require device validation. Node.js is development tooling and a possible server runtime, not a separate Samsung phone implementation. Retain Rust/Axum for the hosted backend. Start delivery on the user’s iPhone, keeping Android support in the shared project from the beginning.

The user already has Apple developer access. App submission, review, and name availability remain separate release steps.

## Architecture

- Phone application: contact list, session tabs, conversation, text composer, speech-to-text input, connection status, and relevant notifications. Speech synthesis can follow later.
- Hosted service: Rust with Axum and Tokio; authentication, authorized device pairing, realtime relay, and persistent user/session metadata. PostgreSQL for metadata. Retain the earlier Render hosting proposal unless deployment needs change.
- Desktop companion: starts easily, maintains an authenticated outbound encrypted connection, and runs the Devin connector. No router configuration or inbound public desktop port.
- Connector boundary: capability-aware discovery, session listing, attach, prompt, event stream, cancel, and approval handling. Expose only verified capabilities. Keep the interface extensible without implementing other providers now.

Application contacts should distinguish machines when needed, so two computers cannot make the destination ambiguous. Hosted services route commands; they do not replace the agent's own session state.

## Input modes and conversational navigation

Deliver the essentials first, followed closely by conversational interaction once the core system runs reliably. Conversation is a primary product feature and early selling point, not a distant enhancement.

- Typing: submit text to the selected session.
- Direct dictation: transcribe speech into the selected session's composer, using the normal send action. It does not implicitly navigate to another destination.
- Conversation: discuss and refine ideas with the AgentYard assistant, search accessible session names, ask whether a tab exists, show it, and switch the active working context. Example: “Is there a tab about the login screen? Show me that one; let's work there.”

Keep conversational drafting separate from execution. Discussion alone does not submit work. When the user asks to send, identify the destination and submit the resulting instruction. Switching tabs does not carry an unfinished task into the new session unless requested. Retain each session's own context; clarify ambiguous matches rather than selecting an arbitrary tab.

The conversational assistant can use structured tools for listing/searching sessions, selecting/showing sessions, sending instructions, checking progress, and creating sessions where supported. MCP is an optional tool protocol, not a required phone runtime or the conversational engine. Select the concrete voice/model API during implementation; support a managed service with optional user-supplied API credentials, stored securely.

Support switching among paired Devin machines in the early conversational phase when the connector supports discovery. Scope active context by machine, application, and stable session ID, and make that destination visible. Other providers such as Cursor remain later connector work using the same navigation model. User-selected hidden tabs stay hidden during ordinary browsing; an explicit search may find an accessible hidden session and offer to show it.

Notify users of actual provider completion, with a project/session label such as “The login-screen task in tab three has finished and is ready for review.” Distinguish reported completion from tested correctness. Use spoken updates during an active voice session and push notifications otherwise, subject to platform permissions and lifecycle support.

## Reliability and control

- Stable machine/application/session identifiers and explicit destination labels.
- Request IDs, reconnect with backoff, and reconciliation after interrupted streams.
- Prevent duplicate submission where supported. Never blindly retry a prompt when execution is uncertain; show an unknown state until reconciled.
- Explicit queued, running, waiting-for-user, completed, failed, canceled, and unknown states, mapped from actual provider events.
- Per-user authorization, revocable paired devices, protected credentials, and minimal sensitive logging.
- Surface provider permission requests faithfully; never interpret a dictated task as approval for a separate pending permission flow.
- Offline status is visible. Do not imply work was delivered before the provider acknowledges it.

## Delivery order

1. Complete the existing Devin Desktop session feasibility spike.
2. Build one desktop-to-service-to-phone round trip into a verified existing session. A mobile web harness is acceptable for this technical proof.
3. Implement the WhatsApp-style application contact and session tabs, with hide/show and persistent ordering.
4. Add text and dictated input, streamed results, and supported questions/approvals/cancellation.
5. Add pairing, reconnect recovery, account isolation, and installer packaging required for real use.
6. Once those essentials run reliably, immediately add conversational drafting and tool-based session discovery/navigation, explicit dispatch, supported session creation, and completion notifications. This is the next delivery phase, not a long-term backlog item.
7. Test on the user's actual Devin installation and an iPhone over cellular, with the desktop elsewhere. Verify the response also remains in Devin Desktop.
8. Package the native phone app and straightforward desktop installer for distribution. App Store acceptance and the AgentYard name remain to be checked.

## First-version acceptance

Essentials: the user can pair once without terminal commands, choose three existing Devin tabs, hide and restore others without closing sessions, select a tab, send typed or dictated instructions, and see the reply in both phone and desktop conversation. Reopening the app preserves destinations and visibility. Disconnection never silently drops or duplicates work. Provider questions and permission requirements remain actionable where supported.

Conversational follow-up acceptance: the user can discuss an idea without sending it, find a session by name, select it, switch to another paired Devin machine where supported, and explicitly send the refined instruction to the intended session. Completion notifications identify the actual task and session. Provider limitations remain visible.

## Deferred

Cursor, IntelliJ, Claude, other application connectors, automatic model selection, team administration, billing, and broader nontechnical workflows. Preserve room for these in the architecture; deliver Devin usefulness first.

This plan supersedes the earlier Safari-only, typed-input demo scope. It is a plan, not evidence that the Devin integration has been verified or implemented.

## Implementation handoff

Start with the mandatory existing-session feasibility milestone and report evidence before expanding the implementation. Do not assume that APIs for cloud agents expose desktop conversations. Once verified, implement the smallest complete path on the founder's actual setup, then follow the delivery order above. Keep installation and pairing representative of the eventual user experience. State unsupported capabilities plainly.

This document describes requirements and proposed technology. It does not claim that AgentYard has been built, that Devin Desktop attachment works, or that a store release has been approved.
