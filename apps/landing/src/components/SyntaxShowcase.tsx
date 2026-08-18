'use client';

import React, { useState } from 'react';
import { motion } from 'framer-motion';

export function SyntaxShowcase() {
  const [activeTab, setActiveTab] = useState<'toolset' | 'policy' | 'rag' | 'memory' | 'module' | 'test'>('toolset');

  return (
    <section id="syntax" className="nest-hero-frame w-full">
      <div className="nest-hero-inner min-h-screen w-full flex items-start relative overflow-hidden pt-28 pb-12">
        <div className="absolute left-[10%] top-[40%] -translate-y-1/2 w-[550px] h-[550px] rounded-full bg-[radial-gradient(circle,rgba(224,35,78,0.28)_0%,transparent_70%)] blur-[100px] pointer-events-none z-0"></div>

        <div className="w-full pl-8 sm:pl-20 lg:pl-28 pr-0 grid grid-cols-1 lg:grid-cols-12 gap-20 items-start relative z-10">
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
            className="lg:col-span-4 space-y-12 text-left self-start pt-4"
          >
            <div className="font-mono text-[11px] text-zinc-500 tracking-[0.2em]">
              &#123; API &#125;
            </div>

            <h2 className="text-4xl sm:text-5xl lg:text-[3.2rem] font-normal tracking-[-0.02em] text-white leading-[1.15] font-sans">
              Governed tools and deterministic tests in NestJS.
            </h2>

            <p className="text-sm text-zinc-500 leading-relaxed font-sans">
              NestJS-native decorators, human-in-the-loop governance policies, multi-agent orchestration, AST Codebase RAG, and durable execution state stores.
            </p>

            <div className="pt-4">
              <a
                href="https://github.com/irzix/nestjs-agentic#readme"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center px-7 py-3 rounded-full bg-[#18181b] hover:bg-[#27272a] text-white font-medium text-sm tracking-tight transition-all border border-zinc-700/40 shadow-lg"
              >
                Read documentation
              </a>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, scale: 0.96, x: 40 }}
            whileInView={{ opacity: 1, scale: 1, x: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
            className="lg:col-span-8 w-full self-start"
          >
            <div className="nest-glass-frame nest-fade-bottom w-full lg:w-[62vw] h-[720px]">
              <div className="bg-[#09090b] rounded-tl-[18px] rounded-bl-[18px] border-t border-l border-b border-white/5 overflow-hidden h-full flex flex-col">
                <div className="flex items-center gap-6 sm:gap-8 px-6 sm:px-10 py-5 border-b border-zinc-800/50 bg-[#0f0f12] text-[13px] font-sans overflow-x-auto">
                  {(['toolset', 'policy', 'rag', 'memory', 'module', 'test'] as const).map((tab) => (
                    <button
                      key={tab}
                      onClick={() => setActiveTab(tab)}
                      className={`transition-colors whitespace-nowrap ${
                        activeTab === tab
                          ? 'text-white font-semibold'
                          : 'text-zinc-500 hover:text-zinc-300 font-normal'
                      }`}
                    >
                      {tab === 'toolset' ? 'ToolSet' : tab === 'policy' ? 'Policy' : tab === 'rag' ? 'RAG Engine' : tab === 'memory' ? 'Memory' : tab === 'module' ? 'Module' : 'Test'}
                    </button>
                  ))}
                </div>

                <div className="px-10 py-10 font-mono text-[13px] leading-[2.2] text-zinc-300 overflow-x-auto bg-[#08080a] flex-1">
                  <CodeBlock tab={activeTab} />
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}

function CodeBlock({ tab }: { tab: string }) {
  const lines: Record<string, string[]> = {
    toolset: [
      `<k>import</k> { ToolSet, Tool, Param, Context, UsePolicies } <k>from</k> <s>'nestjs-agentic'</s>;`,
      `<k>import</k> <k>type</k> { AgentContext } <k>from</k> <s>'nestjs-agentic'</s>;`,
      ``,
      `<w>@ToolSet</w>({ name: <s>'order'</s> })`,
      `<k>export class</k> <w>OrderTools</w> {`,
      `  <k>constructor</k>(<k>private readonly</k> orderService: <w>OrderService</w>) {}`,
      ``,
      `  <w>@Tool</w>({ name: <s>'refundOrder'</s>, description: <s>'Refund an order'</s> })`,
      `  <w>@UsePolicies</w>(RefundLimitPolicy)`,
      `  <k>async</k> <f>refundOrder</f>(`,
      `    <w>@Param</w>(<s>'orderId'</s>) orderId: <t>string</t>,`,
      `    <w>@Param</w>(<s>'amount'</s>, { type: <s>'number'</s> }) amount: <t>number</t>,`,
      `    <w>@Context</w>() ctx: <t>AgentContext</t>,`,
      `  ) {`,
      `    <k>return this</k>.orderService.refund(orderId, amount, ctx.security.userId);`,
      `  }`,
      `}`,
    ],
    policy: [
      `<k>import</k> { Injectable } <k>from</k> <s>'@nestjs/common'</s>;`,
      `<k>import</k> <k>type</k> { ToolPolicy, AgentContext, PolicyResult } <k>from</k> <s>'nestjs-agentic'</s>;`,
      ``,
      `<w>@Injectable</w>()`,
      `<k>export class</k> <w>RefundLimitPolicy</w> <k>implements</k> ToolPolicy {`,
      `  <k>async</k> <f>evaluate</f>(`,
      `    _ctx: <t>AgentContext</t>,`,
      `    _toolName: <t>string</t>,`,
      `    args: <t>Record&lt;string, unknown&gt;</t>,`,
      `  ): <t>Promise&lt;PolicyResult&gt;</t> {`,
      `    <k>return</k> Number(args.amount) > <n>500</n>`,
      `      ? { decision: <s>'require_approval'</s>, reason: <s>'Refund exceeds $500.'</s> }`,
      `      : { decision: <s>'allow'</s> };`,
      `  }`,
      `}`,
    ],
    rag: [
      `<k>import</k> { HybridVectorStore, KnowledgeBase, RAGPipeline, RerankerStrategy }`,
      `  <k>from</k> <s>'@nestjs-agentic/rag'</s>;`,
      ``,
      `// Experimental, opt-in retrieval primitives`,
      `<k>const</k> store = <k>new</k> <w>HybridVectorStore</w>({ embeddingProvider });`,
      `<k>const</k> kb = <k>new</k> <w>KnowledgeBase</w>({ vectorStore: store });`,
      ``,
      `<k>await</k> kb.<f>ingestDocument</f>({`,
      `  title: <s>'Governance Guide'</s>,`,
      `  rawContent: <s>'Refunds above $500 require approval.'</s>,`,
      `  metadata: { tenantId: <s>'acme'</s> },`,
      `});`,
      ``,
      `<k>const</k> pipeline = <k>new</k> <w>RAGPipeline</w>({`,
      `  knowledgeBase: kb,`,
      `  strategies: [<k>new</k> <w>RerankerStrategy</w>({ topK: <n>5</n> })],`,
      `});`,
      ``,
      `<k>const</k> context = <k>await</k> pipeline.<f>executePipeline</f>(`,
      `  <s>'refund approval'</s>, <n>5</n>, { tenantId: <s>'acme'</s> },`,
      `);`,
    ],
    memory: [
      `<k>import</k> { CompositeMemory, ShortTermMemory, SemanticMemory } <k>from</k> <s>'@nestjs-agentic/memory'</s>;`,
      `<k>import</k> { HybridVectorStore } <k>from</k> <s>'@nestjs-agentic/rag'</s>;`,
      ``,
      `// Experimental and explicitly integrated by the application`,
      `<k>const</k> memory = <k>new</k> <w>CompositeMemory</w>([`,
      `  <k>new</k> <w>ShortTermMemory</w>({ maxMessages: <n>20</n> }),`,
      `  <k>new</k> <w>SemanticMemory</w>({ provider: <k>new</k> <w>HybridVectorStore</w>() }),`,
      `]);`,
      ``,
      `<k>await</k> memory.<f>save</f>({`,
      `  id: <s>'pref-1'</s>, sessionId: <s>'s1'</s>, type: <s>'semantic'</s>,`,
      `  content: <s>'User prefers dark mode'</s>,`,
      `});`,
      `<k>const</k> context = <k>await</k> memory.<f>recall</f>(`,
      `  <s>'user preferences'</s>, { sessionId: <s>'s1'</s>, limit: <n>5</n> },`,
      `);`,
    ],
    module: [
      `<k>import</k> { Module } <k>from</k> <s>'@nestjs/common'</s>;`,
      `<k>import</k> { AgenticModule, MockRuntimeAdapter, RUNTIME_ADAPTER } <k>from</k> <s>'nestjs-agentic'</s>;`,
      ``,
      `<k>const</k> message = <s>'Refund $600 for order #42'</s>;`,
      `<k>const</k> mockRuntime = <k>new</k> <w>MockRuntimeAdapter</w>();`,
      `mockRuntime.<f>whenAsked</f>(message).<f>thenCallTool</f>(<s>'refundOrder'</s>, {`,
      `  orderId: <s>'42'</s>, amount: <n>600</n>,`,
      `});`,
      ``,
      `<w>@Module</w>({`,
      `  imports: [`,
      `    <w>AgenticModule</w>.forRoot({`,
      `      defaultModel: { provider: <s>'mock'</s>, model: <s>'deterministic'</s> },`,
      `    }),`,
      `    <w>AgenticModule</w>.forFeature({`,
      `      agents: [SupportAgent], toolSets: [OrderTools], policies: [RefundLimitPolicy],`,
      `    }),`,
      `  ],`,
      `  providers: [{ provide: RUNTIME_ADAPTER, useValue: mockRuntime }],`,
      `})`,
      `<k>export class</k> <w>SupportModule</w> {}`,
    ],
    test: [
      `<k>import</k> { Test } <k>from</k> <s>'@nestjs/testing'</s>;`,
      `<k>import</k> { AgentRunner, MockRuntimeAdapter, RUNTIME_ADAPTER } <k>from</k> <s>'nestjs-agentic'</s>;`,
      ``,
      `it(<s>'requires approval above $500'</s>, <k>async</k> () => {`,
      `  <k>const</k> message = <s>'Refund $600 for order #42'</s>;`,
      `  <k>const</k> mockRuntime = <k>new</k> <w>MockRuntimeAdapter</w>();`,
      `  mockRuntime.<f>whenAsked</f>(message).<f>thenCallTool</f>(<s>'refundOrder'</s>, {`,
      `    orderId: <s>'42'</s>, amount: <n>600</n>,`,
      `  });`,
      ``,
      `  <k>const</k> moduleRef = <k>await</k> Test.<f>createTestingModule</f>({`,
      `    imports: [SupportModule],`,
      `  })`,
      `    .<f>overrideProvider</f>(RUNTIME_ADAPTER)`,
      `    .<f>useValue</f>(mockRuntime)`,
      `    .<f>compile</f>();`,
      ``,
      `  <k>const</k> runner = moduleRef.<f>get</f>(AgentRunner);`,
      `  <k>const</k> result = <k>await</k> runner.<f>run</f>(<s>'support'</s>, {`,
      `    sessionId: <s>'s1'</s>, message,`,
      `  });`,
      `  expect(result.toolCalls[<n>0</n>]?.result).toMatchObject({`,
      `    success: <k>false</k>, status: <s>'pending_approval'</s>,`,
      `  });`,
      `});`,
    ],
  };

  const colorMap: Record<string, string> = {
    k: 'text-rose-400',
    s: 'text-amber-300',
    w: 'text-white',
    f: 'text-cyan-300',
    t: 'text-indigo-300',
    n: 'text-amber-400',
  };

  function renderLine(line: string) {
    if (!line) return '\u00A0';
    const parts = line.split(/(<\/?[a-z]>)/g);
    let currentColor = '';
    return parts.map((part, i) => {
      const openMatch = part.match(/^<([a-z])>$/);
      const closeMatch = part.match(/^<\/[a-z]>$/);
      if (openMatch) {
        currentColor = colorMap[openMatch[1]] || '';
        return null;
      }
      if (closeMatch) {
        currentColor = '';
        return null;
      }
      if (currentColor) {
        return <span key={i} className={currentColor}>{part}</span>;
      }
      return <span key={i}>{part}</span>;
    });
  }

  const codeLines = lines[tab] || [];

  return (
    <div className="flex items-start">
      <div className="text-zinc-600 select-none text-right font-mono mr-8 w-5 text-[13px] leading-[2.2]">
        {codeLines.map((_, i) => (
          <div key={i}>{i + 1}</div>
        ))}
      </div>
      <pre className="text-zinc-300 font-mono text-[13px] leading-[2.2]">
        {codeLines.map((line, i) => (
          <div key={i}>{renderLine(line)}</div>
        ))}
      </pre>
    </div>
  );
}
