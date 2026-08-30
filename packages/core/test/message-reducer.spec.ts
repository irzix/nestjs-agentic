import 'reflect-metadata';
import {
  AgentExecutor,
  BoundedToolHistoryReducer,
  MessageReducerContractError,
  MockModelAdapter,
  fingerprintTranscript,
  validateReduction,
} from '../src';
import type {
  AgentMessageReducer,
  AgentMessageReductionContext,
  AgentObserver,
  ModelMessage,
  ResolvedTool,
  ToolExecutionResult,
} from '../src';

/** A tool that always succeeds with a fixed payload. */
function makeTool(name: string, data: unknown = {}): ResolvedTool {
  return {
    name,
    description: `${name} tool`,
    parameters: [],
    async execute(): Promise<ToolExecutionResult> {
      return { success: true, data };
    },
  };
}

/** A tool that suspends for approval, mirroring a policy's require_approval. */
function makeApprovalTool(name: string, approvalId: string): ResolvedTool {
  return {
    name,
    description: `${name} tool`,
    parameters: [],
    async execute(): Promise<ToolExecutionResult> {
      return {
        success: false,
        status: 'pending_approval',
        reason: 'Needs a human.',
        approvalId,
      };
    },
  };
}

/** Captures the messages sent to the model on each round, in order. */
function capturingObserver(): { observer: AgentObserver; rounds: ModelMessage[][] } {
  const rounds: ModelMessage[][] = [];
  const observer: AgentObserver = {
    onModelRequest(event) {
      rounds.push(event.messages);
    },
  };
  return { observer, rounds };
}

const MODEL = { provider: 'mock', model: 'deterministic' } as const;

export async function runMessageReducerTests() {
  console.log('🧮 Running Message Reducer / Context Projector Tests...\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`  ✅ PASS: ${testName}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${testName} ${detail ? `(${detail})` : ''}`);
      failed++;
    }
  }

  // TEST 1: Identity default — no reducer means the full transcript is sent.
  try {
    const model = new MockModelAdapter();
    model
      .whenAsked('do work')
      .callTool('alpha')
      .callTool('beta')
      .reply('done');

    const { observer, rounds } = capturingObserver();
    const executor = new AgentExecutor(model);

    await executor.execute({
      sessionId: 's1',
      message: 'do work',
      model: MODEL,
      tools: [makeTool('alpha'), makeTool('beta')],
      observers: [observer],
    });

    // Round 3 (final) carries the full transcript: user + 2 completed groups.
    const finalRound = rounds[rounds.length - 1];
    const toolMessages = finalRound.filter((m) => m.role === 'tool');
    assert(rounds.length === 3, 'Test 1a: Three model rounds occurred', `got ${rounds.length}`);
    assert(
      toolMessages.length === 2,
      'Test 1b: Full transcript retains both tool results by default',
      `got ${toolMessages.length}`,
    );
  } catch (err: any) {
    assert(false, 'Test 1: Identity default', err.message);
  }

  // TEST 2: BoundedToolHistoryReducer folds older sequential groups.
  try {
    const model = new MockModelAdapter();
    model
      .whenAsked('do work')
      .callTool('alpha')
      .callTool('beta')
      .reply('done');

    const { observer, rounds } = capturingObserver();
    const executor = new AgentExecutor(model);

    await executor.execute({
      sessionId: 's2',
      message: 'do work',
      model: MODEL,
      tools: [makeTool('alpha'), makeTool('beta')],
      observers: [observer],
      messageReducer: new BoundedToolHistoryReducer({ keepLastToolGroups: 1 }),
    });

    // Final round: alpha's group folded into a summary, beta's group verbatim.
    const finalRound = rounds[rounds.length - 1];
    const toolMessages = finalRound.filter((m) => m.role === 'tool');
    const hasSummary = finalRound.some(
      (m) => m.role === 'user' && m.content.includes('folded to bound context'),
    );
    assert(
      toolMessages.length === 1,
      'Test 2a: Only the last tool group is kept verbatim',
      `got ${toolMessages.length}`,
    );
    assert(hasSummary, 'Test 2b: Older group folded into a run-state summary');
    assert(
      (toolMessages[0] as any).toolName === 'beta',
      'Test 2c: The retained group is the most recent one',
    );
  } catch (err: any) {
    assert(false, 'Test 2: Bounded sequential folding', err.message);
  }

  // TEST 3: Parallel tool calls stay one atomic group.
  try {
    const model = new MockModelAdapter();
    model
      .whenAsked('parallel work')
      .callTools([{ name: 'alpha' }, { name: 'beta' }])
      .callTool('gamma')
      .reply('done');

    const { observer, rounds } = capturingObserver();
    const executor = new AgentExecutor(model);

    await executor.execute({
      sessionId: 's3',
      message: 'parallel work',
      model: MODEL,
      tools: [makeTool('alpha'), makeTool('beta'), makeTool('gamma')],
      observers: [observer],
      messageReducer: new BoundedToolHistoryReducer({ keepLastToolGroups: 1 }),
    });

    // The parallel (alpha+beta) group is older, so it folds whole; gamma stays.
    const finalRound = rounds[rounds.length - 1];
    const toolMessages = finalRound.filter((m) => m.role === 'tool');
    assert(
      toolMessages.length === 1 && (toolMessages[0] as any).toolName === 'gamma',
      'Test 3a: Parallel group folds together, latest single group kept',
      `got ${toolMessages.map((m) => (m as any).toolName).join(',')}`,
    );
  } catch (err: any) {
    assert(false, 'Test 3: Parallel group atomicity', err.message);
  }

  // TEST 4: Streaming path applies the reducer too.
  try {
    const model = new MockModelAdapter();
    model
      .whenAsked('stream work')
      .callTool('alpha')
      .callTool('beta')
      .reply('streamed done');

    const { observer, rounds } = capturingObserver();
    const executor = new AgentExecutor(model);

    for await (const _event of executor.stream({
      sessionId: 's4',
      message: 'stream work',
      model: MODEL,
      tools: [makeTool('alpha'), makeTool('beta')],
      observers: [observer],
      messageReducer: new BoundedToolHistoryReducer({ keepLastToolGroups: 1 }),
    })) {
      // drain
    }

    const finalRound = rounds[rounds.length - 1];
    const toolMessages = finalRound.filter((m) => m.role === 'tool');
    assert(
      toolMessages.length === 1,
      'Test 4a: Reducer applies on the streaming path',
      `got ${toolMessages.length}`,
    );
  } catch (err: any) {
    assert(false, 'Test 4: Streaming reduction', err.message);
  }

  // TEST 5: onModelRequest observes the reduced messages, not the canonical ones.
  try {
    const model = new MockModelAdapter();
    model.whenAsked('observe work').callTool('alpha').callTool('beta').reply('done');

    const { observer, rounds } = capturingObserver();
    const executor = new AgentExecutor(model);

    let transcriptToolCount = -1;
    await executor.execute({
      sessionId: 's5',
      message: 'observe work',
      model: MODEL,
      tools: [makeTool('alpha'), makeTool('beta')],
      observers: [observer],
      messageReducer: new BoundedToolHistoryReducer({ keepLastToolGroups: 1 }),
      onTranscript: (messages) => {
        transcriptToolCount = messages.filter((m) => m.role === 'tool').length;
      },
    });

    const finalRound = rounds[rounds.length - 1];
    const observedToolCount = finalRound.filter((m) => m.role === 'tool').length;
    assert(
      observedToolCount === 1,
      'Test 5a: Observer sees the reduced projection (1 tool group)',
      `got ${observedToolCount}`,
    );
    assert(
      transcriptToolCount === 2,
      'Test 5b: Canonical transcript stays unreduced (2 tool results)',
      `got ${transcriptToolCount}`,
    );
  } catch (err: any) {
    assert(false, 'Test 5: Observer vs canonical separation', err.message);
  }

  // TEST 6: A reducer producing an orphan tool result is rejected.
  try {
    // Drops the assistant tool-call message but keeps its tool result.
    const orphanReducer: AgentMessageReducer = {
      reduce: (messages) => messages.filter((m) => m.role !== 'assistant'),
    };

    const model = new MockModelAdapter();
    model.whenAsked('bad work').callTool('alpha').reply('done');

    const executor = new AgentExecutor(model);
    let caught: unknown;
    try {
      await executor.execute({
        sessionId: 's6',
        message: 'bad work',
        model: MODEL,
        tools: [makeTool('alpha')],
        messageReducer: orphanReducer,
      });
    } catch (err) {
      caught = err;
    }

    assert(
      caught instanceof MessageReducerContractError,
      'Test 6a: Orphan tool result raises MessageReducerContractError',
      caught ? String(caught) : 'no error thrown',
    );
  } catch (err: any) {
    assert(false, 'Test 6: Orphan tool result rejection', err.message);
  }

  // TEST 7: A reducer that mutates its input in place is rejected.
  try {
    const mutatingReducer: AgentMessageReducer = {
      reduce: (messages) => {
        (messages as ModelMessage[]).push({ role: 'user', content: 'injected' });
        return messages;
      },
    };

    const model = new MockModelAdapter();
    model.whenAsked('mutate work').callTool('alpha').reply('done');

    const executor = new AgentExecutor(model);
    let caught: unknown;
    try {
      await executor.execute({
        sessionId: 's7',
        message: 'mutate work',
        model: MODEL,
        tools: [makeTool('alpha')],
        messageReducer: mutatingReducer,
      });
    } catch (err) {
      caught = err;
    }

    assert(
      caught instanceof MessageReducerContractError,
      'Test 7a: In-place mutation raises MessageReducerContractError',
      caught ? String(caught) : 'no error thrown',
    );
  } catch (err: any) {
    assert(false, 'Test 7: Mutation rejection', err.message);
  }

  // TEST 8: The pending-approval group is preserved through reduction.
  try {
    const ctx: AgentMessageReductionContext = {
      executionId: 'e1',
      sessionId: 's8',
      iteration: 0,
      pendingApprovalToolCallId: 'call_keep',
    };

    // A reducer that would drop the approval group entirely.
    const dropApprovalReducer: AgentMessageReducer = {
      reduce: (messages) => messages.filter((m) => m.role === 'user'),
    };

    const transcript: ModelMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'call_keep', name: 'alpha', args: {} }] },
      { role: 'tool', toolCallId: 'call_keep', toolName: 'alpha', content: '{}' },
    ];

    const fp = fingerprintTranscript(transcript);
    const reduced = await dropApprovalReducer.reduce(transcript, ctx);

    let caught: unknown;
    try {
      validateReduction(reduced, transcript, fp, ctx.pendingApprovalToolCallId);
    } catch (err) {
      caught = err;
    }

    assert(
      caught instanceof MessageReducerContractError,
      'Test 8a: Dropping the pending-approval group is rejected',
      caught ? String(caught) : 'no error thrown',
    );

    // And a bounded reducer keeps it even when it is the oldest group.
    const keepReducer = new BoundedToolHistoryReducer({ keepLastToolGroups: 0 });
    const kept = keepReducer.reduce(transcript, ctx);
    const keptIds = kept
      .filter((m) => m.role === 'tool')
      .map((m) => (m as any).toolCallId);
    assert(
      keptIds.includes('call_keep'),
      'Test 8b: BoundedToolHistoryReducer preserves the approval group despite keepLast=0',
      `kept ${keptIds.join(',')}`,
    );
  } catch (err: any) {
    assert(false, 'Test 8: Pending-approval preservation', err.message);
  }

  // TEST 9: Identity reference is accepted and defensively copied.
  try {
    const identityReducer: AgentMessageReducer = { reduce: (messages) => messages };

    const model = new MockModelAdapter();
    model.whenAsked('idem work').callTool('alpha').reply('done');

    const { observer, rounds } = capturingObserver();
    const executor = new AgentExecutor(model);

    await executor.execute({
      sessionId: 's9',
      message: 'idem work',
      model: MODEL,
      tools: [makeTool('alpha')],
      observers: [observer],
      messageReducer: identityReducer,
    });

    const finalRound = rounds[rounds.length - 1];
    assert(
      finalRound.filter((m) => m.role === 'tool').length === 1,
      'Test 9a: Identity reducer sends the full transcript unchanged',
    );
  } catch (err: any) {
    assert(false, 'Test 9: Identity reducer', err.message);
  }

  // TEST 10: End-to-end suspend then resume keeps the pending-approval group
  // in the reduced projection even when the reducer would otherwise fold it.
  try {
    const approvalId = 'appr_1';

    // Initial run: the tool suspends for approval. Capture the withheld transcript.
    const suspendModel = new MockModelAdapter();
    suspendModel
      .whenAsked('approve then finish')
      .callTool('needsApproval')
      .reply('resumed and finished');

    let withheld: ModelMessage[] = [];
    const suspendExecutor = new AgentExecutor(suspendModel);
    await suspendExecutor.execute({
      sessionId: 's10',
      message: 'approve then finish',
      model: MODEL,
      tools: [makeApprovalTool('needsApproval', approvalId)],
      messageReducer: new BoundedToolHistoryReducer({ keepLastToolGroups: 0 }),
      onSuspend: (_id, messages) => {
        withheld = messages;
      },
    });

    const withheldTool = withheld.find((m) => m.role === 'tool') as
      | Extract<ModelMessage, { role: 'tool' }>
      | undefined;
    assert(Boolean(withheldTool), 'Test 10a: Turn suspended with a withheld tool message');
    const toolCallId = withheldTool!.toolCallId;

    // Resume: the reducer (keepLast=0) would fold every group, but the active
    // approval group must survive so the model can react to the outcome.
    const { observer, rounds } = capturingObserver();
    const resumeExecutor = new AgentExecutor(suspendModel);

    const result = await resumeExecutor.resume({
      sessionId: 's10',
      model: MODEL,
      tools: [makeApprovalTool('needsApproval', approvalId)],
      history: withheld,
      toolCallId,
      toolName: 'needsApproval',
      args: {},
      outcome: { success: true, data: { approved: true } } as ToolExecutionResult,
      observers: [observer],
      messageReducer: new BoundedToolHistoryReducer({ keepLastToolGroups: 0 }),
    });

    const firstResumeRound = rounds[0] ?? [];
    const keptIds = firstResumeRound
      .filter((m) => m.role === 'tool')
      .map((m) => (m as any).toolCallId);
    assert(
      keptIds.includes(toolCallId),
      'Test 10b: Reduced projection preserves the pending-approval group on resume',
      `kept ${keptIds.join(',')}`,
    );
    assert(
      result.output === 'resumed and finished',
      'Test 10c: Resumed turn reaches the final answer through the reducer',
      result.output,
    );
  } catch (err: any) {
    assert(false, 'Test 10: End-to-end approval resume', err.message);
  }

  // TEST 11: Folding preserves non-tool messages between folded groups.
  try {
    const ctx: AgentMessageReductionContext = {
      executionId: 'e11',
      sessionId: 's11',
      iteration: 0,
    };
    const transcript: ModelMessage[] = [
      { role: 'user', content: 'start' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'alpha', args: {} }] },
      { role: 'tool', toolCallId: 'c1', toolName: 'alpha', content: '{}' },
      { role: 'user', content: 'interjection between groups' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'c2', name: 'beta', args: {} }] },
      { role: 'tool', toolCallId: 'c2', toolName: 'beta', content: '{}' },
    ];

    const reduced = new BoundedToolHistoryReducer({ keepLastToolGroups: 1 }).reduce(
      transcript,
      ctx,
    );

    const keptInterjection = reduced.some(
      (m) => m.role === 'user' && m.content === 'interjection between groups',
    );
    const foldedFirst = reduced.some(
      (m) => m.role === 'user' && m.content.includes('folded to bound context'),
    );
    assert(
      keptInterjection,
      'Test 11a: A user message between folded groups is preserved',
    );
    assert(foldedFirst, 'Test 11b: The older group was folded');
    assert(
      reduced.filter((m) => m.role === 'tool').length === 1,
      'Test 11c: Only the last tool group stays verbatim',
    );
  } catch (err: any) {
    assert(false, 'Test 11: Intervening message preservation', err.message);
  }

  // TEST 12: The validator rejects out-of-order and duplicate tool calls.
  try {
    const outOfOrder: ModelMessage[] = [
      { role: 'tool', toolCallId: 'c1', toolName: 'alpha', content: '{}' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'alpha', args: {} }] },
    ];
    let caughtOrder: unknown;
    try {
      validateReduction(outOfOrder, [], fingerprintTranscript([]));
    } catch (err) {
      caughtOrder = err;
    }
    assert(
      caughtOrder instanceof MessageReducerContractError,
      'Test 12a: A tool result before its assistant tool-call is rejected',
      caughtOrder ? String(caughtOrder) : 'no error thrown',
    );

    const duplicate: ModelMessage[] = [
      {
        role: 'assistant',
        content: '',
        toolCalls: [
          { id: 'dup', name: 'alpha', args: {} },
          { id: 'dup', name: 'beta', args: {} },
        ],
      },
      { role: 'tool', toolCallId: 'dup', toolName: 'alpha', content: '{}' },
    ];
    let caughtDup: unknown;
    try {
      validateReduction(duplicate, [], fingerprintTranscript([]));
    } catch (err) {
      caughtDup = err;
    }
    assert(
      caughtDup instanceof MessageReducerContractError,
      'Test 12b: A duplicate tool-call id is rejected',
      caughtDup ? String(caughtDup) : 'no error thrown',
    );
  } catch (err: any) {
    assert(false, 'Test 12: Sequential validation', err.message);
  }

  console.log(`\n  Message Reducer: ${passed} passed, ${failed} failed.\n`);
  if (failed > 0) {
    throw new Error('Message Reducer Tests Failed');
  }
}

if (require.main === module) {
  runMessageReducerTests().catch(() => process.exit(1));
}
