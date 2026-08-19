'use client';
import React, { useRef, useCallback, useState, useEffect } from 'react';
import Link from 'next/link';
import { Github, Copy, Check, Sun, Moon } from 'lucide-react';
import { motion } from 'framer-motion';
import { useTheme } from 'next-themes';

export function Header() {
  const [copied, setCopied] = useState(false);
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleCopy = () => {
    navigator.clipboard.writeText('npm i nestjs-agentic');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const isDark = mounted && (theme === 'dark' || resolvedTheme === 'dark');

  return (
    <header className="sticky top-4 sm:top-6 z-50 max-w-4xl mx-auto w-full px-2 sm:px-4">
      <nav className="nest-nav px-4 sm:px-8 py-2.5 sm:py-3 flex items-center justify-between shadow-2xl gap-2">
        <Link href="/" className="font-bold text-xs sm:text-sm tracking-tight text-white font-sans whitespace-nowrap">
          nestjs-agentic
        </Link>

        <div className="hidden md:flex items-center gap-8 text-[13px] font-medium text-zinc-300">
          <a href="/#syntax" className="hover:text-white transition-colors">Syntax</a>
          <a href="/#pillars" className="hover:text-white transition-colors">Overview</a>
          <a href="https://github.com/irzix/nestjs-agentic/blob/main/docs/ROADMAP.md" target="_blank" rel="noreferrer" className="hover:text-white transition-colors">Roadmap</a>
          <Link href="/docs" className="hover:text-white transition-colors">Docs</Link>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          {/* <button
            onClick={() => setTheme(isDark ? 'light' : 'dark')}
            className="text-zinc-400 hover:text-white transition-colors p-1.5 rounded-lg hover:bg-zinc-800/50"
            title={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          >
            {mounted ? (
              isDark ? <Sun className="w-4 h-4 text-amber-300" /> : <Moon className="w-4 h-4 text-zinc-300" />
            ) : (
              <div className="w-4 h-4" />
            )}
          </button> */}

          <a
            href="https://github.com/irzix/nestjs-agentic"
            target="_blank"
            rel="noreferrer"
            className="text-zinc-400 hover:text-white transition-colors p-1.5 rounded-lg hover:bg-zinc-800/50"
            title="GitHub"
          >
            <Github className="w-4 h-4" />
          </a>

          <button
            onClick={handleCopy}
            className="inline-flex items-center gap-1.5 px-2.5 sm:px-3.5 py-1 sm:py-1.5 rounded-full bg-zinc-900/90 hover:bg-zinc-800 border border-zinc-700/50 text-[11px] sm:text-xs font-mono text-zinc-300 hover:text-white transition-all shadow-sm whitespace-nowrap"
            title="Copy install command"
          >
            <span className="hidden sm:inline">npm i nestjs-agentic</span>
            <span className="sm:hidden">npm i</span>
            {copied ? (
              <Check className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-emerald-400" />
            ) : (
              <Copy className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-zinc-400" />
            )}
          </button>
        </div>
      </nav>
    </header>
  );
}

export function HeroSection() {
  const frameRef = useRef<HTMLDivElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!frameRef.current || !glowRef.current) return;
    const rect = frameRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left - 300;
    const y = e.clientY - rect.top - 300;
    glowRef.current.style.transform = `translate(${x}px, ${y}px)`;
    glowRef.current.style.opacity = '1';
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (!glowRef.current) return;
    glowRef.current.style.opacity = '0';
  }, []);

  return (
    <section className="nest-hero-frame w-full">
      <div
        ref={frameRef}
        className="nest-hero-inner min-h-screen w-full flex flex-col justify-between px-4 sm:px-16 py-6 sm:py-8 relative"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        <div ref={glowRef} className="nest-cursor-glow" style={{ opacity: 0 }}></div>
        <div className="nest-orb nest-orb-1"></div>
        <div className="nest-orb nest-orb-2"></div>
        <div className="nest-orb nest-orb-3"></div>

        <Header />

        <div className="my-auto text-center max-w-5xl mx-auto w-full py-12 relative z-10">
          <motion.h1
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
            className="text-[clamp(2.5rem,7.5vw,7rem)] font-semibold tracking-[-0.035em] text-white leading-[0.98] mb-6 sm:mb-8 font-sans"
          >
            Governed AI Agents<br />
            for NestJS
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 25 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
            className="font-mono text-xs sm:text-[13px] text-zinc-400 max-w-2xl mx-auto leading-relaxed mb-10 sm:mb-14 px-4"
          >
            The Enterprise NestJS-native runtime for governed AI agents.<br className="hidden sm:inline" />
            Production-ready multi-agent orchestration, AST Codebase RAG, 5-tier memory, and HITL policy guardrails.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="flex items-center justify-center gap-6 sm:gap-8"
          >
            <a
              href="#syntax"
              className="px-6 sm:px-8 py-2.5 sm:py-3 rounded-full bg-white hover:bg-zinc-200 text-black font-bold text-xs sm:text-sm tracking-tight transition-all shadow-xl shadow-white/10"
            >
              Get started
            </a>
            <a
              href="https://github.com/irzix/nestjs-agentic"
              target="_blank"
              rel="noreferrer"
              className="text-white font-semibold text-xs sm:text-sm hover:text-rose-400 transition-colors"
            >
              GitHub
            </a>
          </motion.div>
        </div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1, delay: 0.5 }}
          className="w-full flex justify-end text-[10px] sm:text-[11px] font-mono text-zinc-500 pt-4 pb-2 relative z-10"
        >
          <div className="text-right space-y-1">
            <div>
              <span className="mr-3 sm:mr-4">License</span>
              <span className="text-white font-semibold">Open Source (MIT)</span>
            </div>
            <div>
              <span className="mr-3 sm:mr-4">Current release line</span>
              <span className="text-emerald-400 font-semibold">v1.0.0 (GA)</span>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
