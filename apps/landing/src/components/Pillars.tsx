'use client';

import React, { useRef, useCallback } from 'react';
import { Layers, ShieldCheck, Database, Brain, GitFork, BarChart3, ArrowUpRight } from 'lucide-react';
import { motion } from 'framer-motion';

const cards = [
  {
    icon: Layers,
    title: 'NestJS Primitives & DI',
    badge: '@ToolSet & @Tool',
    tagline: 'Zero Architecture Drift',
    description: (
      <>
        Define agent tools directly on existing NestJS services. <code className="text-rose-300 font-mono">@ToolSet</code>, <code className="text-rose-300 font-mono">@Tool</code>, <code className="text-rose-300 font-mono">@Param</code>, and <code className="text-rose-300 font-mono">@Context</code> work with full Dependency Injection — no rewrites or microservice overhead.
      </>
    ),
  },
  {
    icon: ShieldCheck,
    title: 'Governance & HITL Safety',
    badge: '@UsePolicies & ApprovalService',
    tagline: 'Enterprise Guardrails',
    description: (
      <>
        Every agent tool call passes through a 3-state policy engine — <code className="text-rose-300 font-mono">allow</code>, <code className="text-rose-300 font-mono">deny</code>, or <code className="text-rose-300 font-mono">require_approval</code>. Sensitive operations pause execution until human supervisor approval.
      </>
    ),
  },
  {
    icon: Database,
    title: 'Enterprise RAG & Vector Stores',
    badge: 'VectorStoreFactory & GraphRAG',
    tagline: 'Available in v0.4.1',
    description: (
      <>
        Bridge any database using <code className="text-rose-300 font-mono">VectorStoreFactory.createCustom()</code> (Prisma + pgvector, PostgreSQL) or in-memory <code className="text-rose-300 font-mono">HybridVectorStore</code>. Features GraphRAG, Reranking, and Late Chunking.
      </>
    ),
  },
  {
    icon: Brain,
    title: 'Multi-Tier Memory & Experience',
    badge: 'CompositeMemory & Learner',
    tagline: 'Self-Learning Agents',
    description: (
      <>
        Combine Short-Term, Long-Term Semantic, Episodic, and Scratchpad memory via <code className="text-rose-300 font-mono">CompositeMemory</code>. Auto-extract lessons from agent errors using <code className="text-rose-300 font-mono">ExperienceLearner</code>.
      </>
    ),
  },
  {
    icon: GitFork,
    title: 'Multi-Agent Orchestration',
    badge: 'Parallel & Refinement Loop',
    tagline: 'Available in v0.4.1',
    description: (
      <>
        Delegate sub-tasks via <code className="text-rose-300 font-mono">SubAgentDelegator</code>, execute parallel consensus agents with <code className="text-rose-300 font-mono">ParallelSubAgentRunner</code>, and run self-correcting refinement loops.
      </>
    ),
  },
  {
    icon: BarChart3,
    title: 'Agent Evaluation & Benchmarking',
    badge: 'BenchmarkRunner & LLM-Judge',
    tagline: 'Available in v0.4.1',
    description: (
      <>
        Quantify agent reliability using <code className="text-rose-300 font-mono">BenchmarkRunner</code>, trajectory inspection, and multi-metric evaluators (<code className="text-rose-300 font-mono">SafetyPolicyMetric</code>, <code className="text-rose-300 font-mono">LLMAsAJudgeMetric</code>).
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
    <section id="pillars" className="nest-hero-frame w-full">
      <div
        ref={frameRef}
        className="nest-hero-inner min-h-screen w-full flex flex-col justify-center px-8 sm:px-20 lg:px-28 py-32 relative overflow-hidden"
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
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          className="max-w-4xl text-left mb-20 relative z-10 space-y-4"
        >
          <div className="font-mono text-[11px] text-zinc-500 tracking-[0.2em]">
            &#123; THE 4 CORE PILLARS &#125;
          </div>
          <h2 className="text-4xl sm:text-5xl lg:text-[3.2rem] font-normal tracking-[-0.02em] text-white leading-[1.15] font-sans">
            Agentic infrastructure built<br />on NestJS, not around it.
          </h2>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 relative z-10">
          {cards.map((card, idx) => {
            const Icon = card.icon;
            return (
              <motion.div
                key={card.title}
                initial={{ opacity: 0, y: 35 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ duration: 0.7, delay: idx * 0.1, ease: [0.16, 1, 0.3, 1] }}
                className="nest-glass-card p-8 sm:p-10 flex flex-col justify-between min-h-[300px] sm:min-h-[320px] relative overflow-hidden group"
              >
                <div>
                  <div className="w-12 h-12 rounded-2xl bg-rose-600/10 border border-rose-500/20 flex items-center justify-center text-rose-400 mb-8 shadow-inner">
                    <Icon className="w-6 h-6" />
                  </div>

                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-2xl font-medium text-white tracking-tight font-sans">
                      {card.title}
                    </h3>
                    <ArrowUpRight className="w-5 h-5 text-zinc-600 group-hover:text-rose-400 transition-colors" />
                  </div>

                  <p className="text-sm text-zinc-400 leading-relaxed font-sans max-w-md font-normal">
                    {card.description}
                  </p>
                </div>

                <div className="pt-8 mt-6 border-t border-white/5 flex items-center justify-between text-xs font-mono">
                  <span className="text-rose-400/90 font-medium">{card.badge}</span>
                  <span className="text-zinc-600">{card.tagline}</span>
                </div>
              </motion.div>
            );
          })}
        </div>

      </div>
    </section>
  );
}
