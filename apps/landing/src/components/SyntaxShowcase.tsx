'use client';

import React, { useState } from 'react';
import { motion } from 'framer-motion';

export function SyntaxShowcase() {
  const [activeTab, setActiveTab] = useState<'toolset' | 'policy' | 'module' | 'test'>('toolset');

  return (
    <section id="syntax" className="nest-hero-frame w-full">
      <div className="nest-hero-inner min-h-screen w-full flex items-start relative overflow-hidden pt-28 pb-12">

        {/* Red ambient glow */}
        <div className="absolute left-[10%] top-[40%] -translate-y-1/2 w-[550px] h-[550px] rounded-full bg-[radial-gradient(circle,rgba(224,35,78,0.28)_0%,transparent_70%)] blur-[100px] pointer-events-none z-0"></div>

        <div className="w-full pl-8 sm:pl-20 lg:pl-28 pr-0 grid grid-cols-1 lg:grid-cols-12 gap-20 items-start relative z-10">

          {/* Left: Title + Button — Top Aligned */}
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
            className="lg:col-span-4 space-y-12 text-left self-start pt-4"
          >
            <div className="font-mono text-[11px] text-zinc-500 tracking-[0.2em]">
              &#123; API &#125;
            </div>

            <h2 className="text-4xl sm:text-5xl lg:text-[3.2rem] font-normal tracking-[-0.02em] text-white leading-[1.15] font-sans">
              Agents, tools, and policies in pure NestJS.
            </h2>

            <p className="text-sm text-zinc-500 leading-relaxed font-sans">
              No new framework. No wrappers. Define your agents with the same decorator patterns you already know — and governance runs automatically between every tool call and every LLM.
            </p>

            <div className="pt-4">
              <a
                href="https://github.com/irzix/nestjs-agentic#readme"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center px-7 py-3 rounded-full bg-[#18181b] hover:bg-[#27272a] text-white font-medium text-sm tracking-tight transition-all border border-zinc-700/40 shadow-lg"
              >
                Official documentation
              </a>
            </div>
          </motion.div>

          {/* Right: Code Monitor bleeding right AND fading smoothly at the bottom */}
          <motion.div
            initial={{ opacity: 0, scale: 0.96, x: 40 }}
            whileInView={{ opacity: 1, scale: 1, x: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
            className="lg:col-span-8 w-full self-start"
          >
            <div className="nest-glass-frame nest-fade-bottom w-full lg:w-[62vw] h-[720px]">
              <div className="bg-[#09090b] rounded-tl-[18px] rounded-bl-[18px] border-t border-l border-b border-white/5 overflow-hidden h-full flex flex-col">

                {/* Tab Bar */}
                <div className="flex items-center gap-10 px-10 py-5 border-b border-zinc-800/50 bg-[#0f0f12] text-[13px] font-sans">
                  {(['toolset', 'policy', 'module', 'test'] as const).map((tab) => (
                    <button
                      key={tab}
                      onClick={() => setActiveTab(tab)}
                      className={`transition-colors ${
                        activeTab === tab
                          ? 'text-white font-semibold'
                          : 'text-zinc-500 hover:text-zinc-300 font-normal'
                      }`}
                    >
                      {tab === 'toolset' ? 'ToolSet' : tab === 'policy' ? 'Policy' : tab === 'module' ? 'Module' : 'Test'}
                    </button>
                  ))}
                </div>

                {/* Code */}
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
      `<w>@ToolSet</w>({ name: <s>'order'</s>, tags: [<s>'order'</s>, <s>'sales'</s>] })`,
      `<k>export class</k> <w>OrderTools</w> {`,
      `  <k>constructor</k>(<k>private readonly</k> orderService: <w>OrderService</w>) {}`,
      ``,
      `  <w>@Tool</w>({ description: <s>'Refund an order by ID and amount'</s> })`,
      `  <w>@UsePolicies</w>(RefundLimitPolicy)`,
      `  <k>async</k> <f>refundOrder</f>(`,
      `    <w>@Param</w>(<s>'orderId'</s>) orderId: <t>string</t>,`,
      `    <w>@Param</w>(<s>'amount'</s>) amount: <t>number</t>,`,
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
      `    ctx: <t>AgentContext</t>,`,
      `    toolName: <t>string</t>,`,
      `    args: <t>Record&lt;string, unknown&gt;</t>,`,
      `  ): <t>Promise&lt;PolicyResult&gt;</t> {`,
      `    <k>return</k> Number(args.amount) > <n>500</n>`,
      `      ? { decision: <s>'require_approval'</s>, reason: <s>'Refund exceeds $500 threshold.'</s> }`,
      `      : { decision: <s>'allow'</s> };`,
      `  }`,
      `}`,
    ],
    module: [
      `<k>import</k> { Module } <k>from</k> <s>'@nestjs/common'</s>;`,
      `<k>import</k> { AgenticModule, RUNTIME_ADAPTER, Agent } <k>from</k> <s>'nestjs-agentic'</s>;`,
      `<k>import</k> <k>type</k> { AgentProvider, AgentConfig } <k>from</k> <s>'nestjs-agentic'</s>;`,
      `<k>import</k> { AdkRuntimeAdapter } <k>from</k> <s>'@nestjs-agentic/adk'</s>;`,
      ``,
      `<w>@Agent</w>({ name: <s>'support'</s>, description: <s>'Handles refund inquiries'</s> })`,
      `<k>export class</k> <w>SupportAgent</w> <k>implements</k> AgentProvider {`,
      `  <k>constructor</k>(<k>private readonly</k> orderTools: <w>OrderTools</w>) {}`,
      `  <f>define</f>(): <t>AgentConfig</t> {`,
      `    <k>return</k> { instructions: <s>'You are a helpful support agent.'</s>, tools: [<k>this</k>.orderTools] };`,
      `  }`,
      `}`,
      ``,
      `<w>@Module</w>({`,
      `  imports: [`,
      `    <w>AgenticModule</w>.forRoot({ defaultModel: { provider: <s>'google'</s>, model: <s>'gemini-2.0-flash'</s> } }),`,
      `    <w>AgenticModule</w>.forFeature({ agents: [SupportAgent], toolSets: [OrderTools], policies: [RefundLimitPolicy] }),`,
      `  ],`,
      `  providers: [{ provide: RUNTIME_ADAPTER, useClass: AdkRuntimeAdapter }],`,
      `})`,
      `<k>export class</k> <w>SupportModule</w> {}`,
    ],
    test: [
      `<k>import</k> { Test } <k>from</k> <s>'@nestjs/testing'</s>;`,
      `<k>import</k> { AgenticModule, AgentRunner, MockRuntimeAdapter, RUNTIME_ADAPTER } <k>from</k> <s>'nestjs-agentic'</s>;`,
      ``,
      `describe(<s>'SupportAgent — Refund Policy'</s>, () => {`,
      `  <k>let</k> runner: <t>AgentRunner</t>;`,
      ``,
      `  beforeEach(<k>async</k> () => {`,
      `    <k>const</k> module = <k>await</k> Test.createTestingModule({`,
      `      imports: [`,
      `        AgenticModule.forRoot({ defaultModel: { provider: <s>'google'</s>, model: <s>'gemini-2.0-flash'</s> } }),`,
      `        AgenticModule.forFeature({ agents: [SupportAgent], toolSets: [OrderTools], policies: [RefundLimitPolicy] }),`,
      `      ],`,
      `      providers: [{ provide: RUNTIME_ADAPTER, useClass: MockRuntimeAdapter }],`,
      `    }).compile();`,
      `    runner = module.get(AgentRunner);`,
      `  });`,
      ``,
      `  it(<s>'should require approval on refund > $500'</s>, <k>async</k> () => {`,
      `    <k>const</k> result = <k>await</k> runner.run(<s>'support'</s>, { sessionId: <s>'s1'</s>, message: <s>'Refund $600 order #42'</s> });`,
      `    expect(result.toolCalls[<n>0</n>].result.status).toBe(<s>'pending_approval'</s>);`,
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
