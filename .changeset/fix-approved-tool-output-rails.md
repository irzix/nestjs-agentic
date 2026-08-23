---
'@nestjs-agentic/core': patch
---

Fix `LocalToolProvider.invokeApprovedTool()` executing an approved tool and returning its raw result without ever running the post-execution Output Rail chain (`evaluateOutput`). An approved call is often the most sensitive one a tool makes, and its result now passes through the same `evaluateOutput` chain as a normal `allow`-decision call, so `SecretRedactionPolicy`, `CanaryDetectionPolicy`, and custom output rails can no longer be bypassed by requiring human approval.

- `invokeApprovedTool` now accepts an optional `agentName` parameter, threaded through from `AgentRunner.settleApproval()` so approval-resume audit events (`tool_output_policy_decision`) carry the correct agent name.
- Extracted the shared output-rail loop into a private `runOutputRails()` method used by both the normal policy-guarded tool closure and `invokeApprovedTool`, so the two paths cannot drift again.
- Pre-execution policy evaluation on the approval-resume path is unchanged: policies before the one that required approval already ran once, and are not re-evaluated on resume, matching prior behavior.
