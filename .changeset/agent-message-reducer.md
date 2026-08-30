---
'@nestjs-agentic/core': minor
---

Add a provider-agnostic message reducer (context projector) that bounds tool-loop context growth. The executor keeps one append-only transcript per turn and re-sends it in full every round, so intermediate tool observations are billed again on every later request even inside the allowed loop. A reducer projects a bounded view for the model while leaving the canonical transcript, checkpoints, and approval resume unchanged.

Configure through `AgenticModule.forRoot({ messageReducer })`, override per agent via `AgentConfig.messageReducer`, or per run via `RunInput.messageReducer`, resolved with the same precedence as limits. Unset is identity behavior, so existing runs are unchanged. The projection is applied consistently across `execute`, `stream`, `resume`, `resumeStream`, and checkpoint-resume, and runs before `onModelRequest`, so observers see the exact messages the adapter receives.

- `AgentMessageReducer`, `AgentMessageReductionContext` — the reduction contract, invoked once per model round.
- `BoundedToolHistoryReducer` — a deterministic reducer that keeps the last N complete tool groups verbatim and folds older ones into a compact run-state message, with no extra LLM summarization call. It always preserves the active pending-approval group.
- `validateReduction`, `fingerprintTranscript` — validate a projection against the tool protocol (no orphan tool result, no split group, pending-approval group preserved, no input mutation), exported so custom reducers can self-check.
- `MessageReducerContractError` — raised when a reducer returns a projection a provider would reject, rather than sending it.

Closes #185.
