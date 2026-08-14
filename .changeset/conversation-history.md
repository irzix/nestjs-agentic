---
'@nestjs-agentic/core': minor
---

Make multi-turn conversation work.

`AgentRunner` never loaded or saved conversation state, so every `run()` started from scratch and an agent could not remember the previous message. The built-in runtime now replays and persists history per session.

- history is stored through `SessionStore`, keyed by `tenantId:sessionId` so two tenants cannot share a transcript
- retention keeps the most recent messages, and trimming never leaves a tool result without the assistant message that requested it
- system messages are not stored, since agent instructions are reapplied each turn
- history is written when a turn ends or suspends for approval, never on failure
- a failing history read does not fail the turn
- `RunInput.history: false` runs a single turn statelessly, and `session.enabled: false` disables the feature
- `forRoot()` accepts `sessionStore` and `session` options
- `AgentExecutionInput` gains `onTranscript`, the hook the runner uses to persist a completed turn

Also fixes `MockModelAdapter`, which selected its scripted round by counting every assistant message. Replayed history shifted the script, so rounds are now counted from the latest user message.

History applies to the built-in runtime. Applications that delegate turns to a `RuntimeAdapter` continue to own their own state.
