'use client';

import React, { useRef, useCallback } from 'react';
import { Layers, ShieldCheck, Cpu, GitFork, ArrowUpRight } from 'lucide-react';
import { motion } from 'framer-motion';

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
        
        {/* Interactive Mouse-Follow Red Glow */}
        <div ref={glowRef} className="nest-cursor-glow" style={{ opacity: 0 }}></div>

        {/* Wandering Ambient Orbs */}
        <div className="nest-orb nest-orb-1"></div>
        <div className="nest-orb nest-orb-2"></div>
        <div className="nest-orb nest-orb-3"></div>

        {/* Section Header */}
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
            Enterprise Agentic Infrastructure for NestJS.
          </h2>
        </motion.div>

        {/* 2x2 Grid of Large Glass Feature Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 relative z-10">
          
          {/* Card 1: NestJS Primitives & DI */}
          <motion.div
            initial={{ opacity: 0, y: 35 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.7, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
            className="nest-glass-card p-8 sm:p-10 flex flex-col justify-between min-h-[300px] sm:min-h-[320px] relative overflow-hidden group"
          >
            <div>
              <div className="w-12 h-12 rounded-2xl bg-rose-600/10 border border-rose-500/20 flex items-center justify-center text-rose-400 mb-8 shadow-inner">
                <Layers className="w-6 h-6" />
              </div>

              <div className="flex items-center justify-between mb-4">
                <h3 className="text-2xl font-medium text-white tracking-tight font-sans">
                  NestJS Primitives &amp; DI
                </h3>
                <ArrowUpRight className="w-5 h-5 text-zinc-600 group-hover:text-rose-400 transition-colors" />
              </div>

              <p className="text-sm text-zinc-400 leading-relaxed font-sans max-w-md font-normal">
                Expose existing backend services directly with <code className="text-rose-300 font-mono">@ToolSet</code>, <code className="text-rose-300 font-mono">@Tool</code>, and <code className="text-rose-300 font-mono">@Context</code> decorators. Full Dependency Injection integration.
              </p>
            </div>

            <div className="pt-8 mt-6 border-t border-white/5 flex items-center justify-between text-xs font-mono">
              <span className="text-rose-400/90 font-medium">@ToolSet &amp; @Tool</span>
              <span className="text-zinc-600">Zero Architecture Drift</span>
            </div>
          </motion.div>

          {/* Card 2: Governance & HITL Safety */}
          <motion.div
            initial={{ opacity: 0, y: 35 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.7, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="nest-glass-card p-8 sm:p-10 flex flex-col justify-between min-h-[300px] sm:min-h-[320px] relative overflow-hidden group"
          >
            <div>
              <div className="w-12 h-12 rounded-2xl bg-rose-600/10 border border-rose-500/20 flex items-center justify-center text-rose-400 mb-8 shadow-inner">
                <ShieldCheck className="w-6 h-6" />
              </div>

              <div className="flex items-center justify-between mb-4">
                <h3 className="text-2xl font-medium text-white tracking-tight font-sans">
                  Governance &amp; HITL Safety
                </h3>
                <ArrowUpRight className="w-5 h-5 text-zinc-600 group-hover:text-rose-400 transition-colors" />
              </div>

              <p className="text-sm text-zinc-400 leading-relaxed font-sans max-w-md font-normal">
                3-state policy engine (<code className="text-rose-300 font-mono">allow</code>, <code className="text-rose-300 font-mono">deny</code>, <code className="text-rose-300 font-mono">require_approval</code>). Pause sensitive execution and resume upon human supervisor approval via <code className="text-rose-300 font-mono">ApprovalService</code>.
              </p>
            </div>

            <div className="pt-8 mt-6 border-t border-white/5 flex items-center justify-between text-xs font-mono">
              <span className="text-rose-400/90 font-medium">@UsePolicies &amp; HITL</span>
              <span className="text-zinc-600">Enterprise Guardrails</span>
            </div>
          </motion.div>

          {/* Card 3: Pluggable Ecosystem Adapters */}
          <motion.div
            initial={{ opacity: 0, y: 35 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.7, delay: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="nest-glass-card p-8 sm:p-10 flex flex-col justify-between min-h-[300px] sm:min-h-[320px] relative overflow-hidden group"
          >
            <div>
              <div className="w-12 h-12 rounded-2xl bg-rose-600/10 border border-rose-500/20 flex items-center justify-center text-rose-400 mb-8 shadow-inner">
                <Cpu className="w-6 h-6" />
              </div>

              <div className="flex items-center justify-between mb-4">
                <h3 className="text-2xl font-medium text-white tracking-tight font-sans">
                  Ecosystem Adapters
                </h3>
                <ArrowUpRight className="w-5 h-5 text-zinc-600 group-hover:text-rose-400 transition-colors" />
              </div>

              <p className="text-sm text-zinc-400 leading-relaxed font-sans max-w-md font-normal">
                Connect seamlessly to Google ADK (<code className="text-rose-300 font-mono">@nestjs-agentic/adk</code>), Vercel AI SDK, LangGraph, or custom LLM runtimes with zero framework lock-in.
              </p>
            </div>

            <div className="pt-8 mt-6 border-t border-white/5 flex items-center justify-between text-xs font-mono">
              <span className="text-rose-400/90 font-medium">RuntimeAdapter API</span>
              <span className="text-zinc-600">Vendor Agnostic</span>
            </div>
          </motion.div>

          {/* Card 4: Multi-Agent Orchestration */}
          <motion.div
            initial={{ opacity: 0, y: 35 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.7, delay: 0.4, ease: [0.16, 1, 0.3, 1] }}
            className="nest-glass-card p-8 sm:p-10 flex flex-col justify-between min-h-[300px] sm:min-h-[320px] relative overflow-hidden group"
          >
            <div>
              <div className="w-12 h-12 rounded-2xl bg-rose-600/10 border border-rose-500/20 flex items-center justify-center text-rose-400 mb-8 shadow-inner">
                <GitFork className="w-6 h-6" />
              </div>

              <div className="flex items-center justify-between mb-4">
                <h3 className="text-2xl font-medium text-white tracking-tight font-sans">
                  Multi-Agent Orchestration
                </h3>
                <ArrowUpRight className="w-5 h-5 text-zinc-600 group-hover:text-rose-400 transition-colors" />
              </div>

              <p className="text-sm text-zinc-400 leading-relaxed font-sans max-w-md font-normal">
                Delegate sub-tasks across specialized sub-agents via <code className="text-rose-300 font-mono">subAgents</code> with isolated sub-context governance and immutable audit trails.
              </p>
            </div>

            <div className="pt-8 mt-6 border-t border-white/5 flex items-center justify-between text-xs font-mono">
              <span className="text-rose-400/90 font-medium">Sub-Agent Workflows</span>
              <span className="text-zinc-600">Complex Agent Systems</span>
            </div>
          </motion.div>

        </div>

      </div>
    </section>
  );
}
