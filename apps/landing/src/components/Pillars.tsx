'use client';

import React, { useRef, useCallback } from 'react';
import {
  Layers,
  ShieldCheck,
  Database,
  Brain,
  GitFork,
  BarChart3,
  ArrowUpRight,
  Repeat,
} from 'lucide-react';
import { motion } from 'framer-motion';

const cards = [
  {
    icon: Layers,
    title: 'NestJS Primitives & DI',
    badge: '@Agent, @ToolSet, @Tool',
    tagline: 'Production Ready · v1.x GA',
    description: (
      <>
        Define agents and context-bound tools with NestJS decorators, dependency injection, and capability narrowing. Application services remain ordinary providers while runtimes receive governed tool closures.
      </>
    ),
  },
  {
    icon: Repeat,
    title: 'Built-in Agent Runtime',
    badge: 'AgentExecutor & ModelAdapter',
    tagline: 'Production Ready · Full Streaming',
    description: (
      <>
        The framework manages the model-to-tool loop, parameter schema validation, token execution limits, OpenTelemetry tracing, and per-session conversation history. <code className="text-rose-300 font-mono">@nestjs-agentic/openai</code> connects OpenAI and any Chat Completions compatible endpoint.
      </>
    ),
  },
  {
    icon: ShieldCheck,
    title: 'Tool Governance & HITL',
    badge: '@UsePolicies & ApprovalService',
    tagline: 'Production Ready · Durable State',
    description: (
      <>
        Every tool call crosses an <code className="text-rose-300 font-mono">allow</code>, <code className="text-rose-300 font-mono">deny</code>, or <code className="text-rose-300 font-mono">require_approval</code> policy boundary. Approval decisions resume suspended model turns with durable Postgres and Redis state stores.
      </>
    ),
  },
  {
    icon: Database,
    title: 'AST Codebase RAG',
    badge: 'KnowledgeBase & HybridVectorStore',
    tagline: 'Production Ready · Graph & Hierarchical',
    description: (
      <>
        Deep semantic codebase intelligence featuring AST hierarchical chunking, Hybrid BM25 + Vector retrieval, Cross-Encoder rerankers, Parent-Child hydration, and GraphRAG relational query expansion.
      </>
    ),
  },
  {
    icon: Brain,
    title: '5-Tier Memory & Experience',
    badge: 'CompositeMemory & ExperienceLearner',
    tagline: 'Production Ready · Tri-Factor Scoring',
    description: (
      <>
        Five-tier composite memory (Short-Term, Long-Term, Semantic, Scratchpad, and Episodic). Includes self-reflective trajectory critiques and Stanford tri-factor retrieval scoring to prevent repeating past failures.
      </>
    ),
  },
  {
    icon: GitFork,
    title: 'Multi-Agent Orchestration',
    badge: 'Fan-Out, Consensus, & Debate',
    tagline: 'Production Ready · Fleiss\' Kappa',
    description: (
      <>
        Autonomous multi-agent collaboration with parallel fan-out (<code className="text-rose-300 font-mono">ParallelSubAgentRunner</code>), supervisor-worker refinement loops, multi-agent debate rounds, and Fleiss' Kappa consensus convergence.
      </>
    ),
  },
  {
    icon: BarChart3,
    title: 'LLM-as-a-Judge Evaluation',
    badge: 'DebiasedJudge & BenchmarkRunner',
    tagline: 'Production Ready · CI Quality Gates',
    description: (
      <>
        Production evaluation suite featuring position-debiased pairwise LLM judges, automated accuracy/efficiency benchmark runners, and continuous regression gates.
      </>
    ),
  },
];

export function Pillars() {
  const frameRef = useRef<HTMLDivElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!frameRef.current || !glowRef.current) return;
    const rect = frameRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left - 400;
    const y = e.clientY - rect.top - 400;
    glowRef.current.style.transform = `translate(${x}px, ${y}px)`;
    glowRef.current.style.opacity = '1';
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (!glowRef.current) return;
    glowRef.current.style.opacity = '0';
  }, []);

  return (
    <section id="pillars" className="nest-hero-frame w-full p-2 sm:p-4">
      <div
        ref={frameRef}
        className="nest-hero-inner min-h-screen w-full flex flex-col justify-center px-4 sm:px-12 lg:px-24 py-16 sm:py-24 lg:py-32 relative overflow-hidden"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        <div ref={glowRef} className="nest-cursor-glow" style={{ opacity: 0 }}></div>
        <div className="nest-orb nest-orb-1"></div>
        <div className="nest-orb nest-orb-2"></div>
        <div className="nest-orb nest-orb-3"></div>

        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          className="max-w-4xl text-left mb-10 sm:mb-16 relative z-10 space-y-3 sm:space-y-4"
        >
          <div className="font-mono text-[10px] sm:text-[11px] text-zinc-500 tracking-[0.2em]">
            &#123; ENTERPRISE CAPABILITIES &#125;
          </div>
          <h2 className="text-2xl sm:text-4xl lg:text-[3.2rem] font-normal tracking-[-0.02em] text-white leading-tight sm:leading-[1.15] font-sans">
            Enterprise AI Agent Architecture.<br className="hidden sm:inline" /> Engineered for production resilience.
          </h2>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6 lg:gap-8 relative z-10">
          {cards.map((card, idx) => {
            const Icon = card.icon;
            return (
              <motion.div
                key={card.title}
                initial={{ opacity: 0, y: 35 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-60px' }}
                transition={{ duration: 0.7, delay: idx * 0.1, ease: [0.16, 1, 0.3, 1] }}
                className="nest-glass-card p-6 sm:p-8 lg:p-10 flex flex-col justify-between min-h-0 sm:min-h-[320px] rounded-2xl relative overflow-hidden group"
              >
                <div>
                  <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl bg-rose-600/10 border border-rose-500/20 flex items-center justify-center text-rose-400 mb-5 sm:mb-8 shadow-inner">
                    <Icon className="w-5 h-5 sm:w-6 sm:h-6" />
                  </div>

                  <div className="flex items-center justify-between mb-3 sm:mb-4">
                    <h3 className="text-lg sm:text-2xl font-medium text-white tracking-tight font-sans">
                      {card.title}
                    </h3>
                    <ArrowUpRight className="w-4 h-4 sm:w-5 sm:h-5 text-zinc-600 group-hover:text-rose-400 transition-colors" />
                  </div>

                  <p className="text-xs sm:text-sm text-zinc-400 leading-relaxed font-sans max-w-none sm:max-w-md font-normal">
                    {card.description}
                  </p>
                </div>

                <div className="pt-5 sm:pt-8 mt-5 sm:mt-6 border-t border-white/5 flex flex-col sm:flex-row sm:items-center justify-between text-xs font-mono gap-1.5 sm:gap-0">
                  <span className="text-rose-400/90 font-medium">{card.badge}</span>
                  <span className="text-zinc-500 sm:text-zinc-600 text-[11px] sm:text-xs">{card.tagline}</span>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
