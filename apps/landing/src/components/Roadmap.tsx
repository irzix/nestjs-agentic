'use client';

import React from 'react';
import { CheckCircle2, Clock, Sparkles, ShieldAlert } from 'lucide-react';
import { motion } from 'framer-motion';

export function Roadmap() {
  const phases = [
    {
      phase: 'Phase 0.1',
      title: 'Core Primitives & Safety',
      status: 'Released',
      statusColor: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10',
      icon: CheckCircle2,
      items: [
        'NestJS Decorators (@ToolSet, @Tool, @Param, @Context)',
        '3-State Policy Guardrails (allow, deny, require_approval)',
        'Context Pre-Binding & Security Isolation',
        'Official @nestjs-agentic/adk Google ADK Adapter',
        'Built-in MockRuntimeAdapter for headless unit testing',
      ],
    },
    {
      phase: 'Phase 0.2',
      title: 'Enterprise Governance Matrix',
      status: 'In Progress',
      statusColor: 'text-rose-400 border-rose-500/30 bg-rose-500/10',
      icon: Clock,
      items: [
        'Composite Policies (TenantIsolation, TieredApproval, RiskScore)',
        'Role-Aware Human-in-the-Loop (requiredRole: "finance_manager")',
        'Sub-Agent Delegation via AgentConfig.subAgents',
        'Vercel AI SDK & LangGraph Adapters',
        'MCP (Model Context Protocol) Transport Provider',
      ],
    },
    {
      phase: 'Phase 0.3',
      title: 'Observability & Audit Trail',
      status: 'Upcoming',
      statusColor: 'text-zinc-400 border-zinc-700/50 bg-zinc-800/30',
      icon: Sparkles,
      items: [
        'Immutable Audit Trail (AuditEventStore) for EU AI Act & SOC2',
        'OpenTelemetry Exporter for Agent Traces',
        'Langfuse & Arize Phoenix Observability Integration',
      ],
    },
    {
      phase: 'Phase 1.0',
      title: 'Durable & Distributed Execution',
      status: 'Planned',
      statusColor: 'text-zinc-500 border-zinc-800 bg-zinc-900/50',
      icon: ShieldAlert,
      items: [
        'Durable HITL Workflows (Temporal.io & BullMQ)',
        'Distributed Redis Session & Pending Approval Stores',
        'Multi-instance Cluster Synchronization',
      ],
    },
  ];

  return (
    <section id="roadmap" className="nest-hero-frame w-full">
      <div className="nest-hero-inner min-h-screen w-full flex flex-col justify-center px-8 sm:px-20 lg:px-28 py-32 relative overflow-hidden">
        
        {/* Section Header */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          className="max-w-4xl text-left mb-20 relative z-10 space-y-4"
        >
          <div className="font-mono text-[11px] text-zinc-500 tracking-[0.2em]">
            &#123; PRODUCT ROADMAP &#125;
          </div>
          <h2 className="text-4xl sm:text-5xl lg:text-[3.2rem] font-normal tracking-[-0.02em] text-white leading-[1.15] font-sans">
            Built for today. Designed for the future of AI Agents.
          </h2>
        </motion.div>

        {/* Roadmap Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 relative z-10">
          {phases.map((p, idx) => {
            const Icon = p.icon;
            return (
              <motion.div
                key={p.phase}
                initial={{ opacity: 0, y: 35 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ duration: 0.7, delay: idx * 0.1, ease: [0.16, 1, 0.3, 1] }}
                className="nest-glass-card p-8 sm:p-10 flex flex-col justify-between relative overflow-hidden"
              >
                <div>
                  <div className="flex items-center justify-between mb-6">
                    <span className="font-mono text-xs text-zinc-400 font-semibold">{p.phase}</span>
                    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono border ${p.statusColor}`}>
                      <Icon className="w-3.5 h-3.5" />
                      {p.status}
                    </span>
                  </div>

                  <h3 className="text-2xl font-medium text-white tracking-tight font-sans mb-6">
                    {p.title}
                  </h3>

                  <ul className="space-y-3 font-sans text-sm text-zinc-400">
                    {p.items.map((item) => (
                      <li key={item} className="flex items-start gap-2.5">
                        <span className="text-rose-500/80 mt-1">•</span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </motion.div>
            );
          })}
        </div>

      </div>
    </section>
  );
}
