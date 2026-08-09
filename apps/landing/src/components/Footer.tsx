'use client';

import React from 'react';
import { Github } from 'lucide-react';
import { motion } from 'framer-motion';

export function Footer() {
  return (
    <footer className="w-full bg-black h-full flex flex-col justify-center items-center py-20 px-6 sm:px-16 text-center border-t border-zinc-900/80 relative">
      <div className="max-w-3xl mx-auto space-y-8">
        
        {/* Punchy Developer Statement */}
        <motion.h2
          initial={{ opacity: 0, y: 25 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          className="text-3xl sm:text-4xl lg:text-[2.6rem] font-normal tracking-[-0.02em] text-white leading-[1.28] font-sans"
        >
          No separate AI microservices. No framework lock-in. Just NestJS.
        </motion.h2>

        {/* ONLY GitHub Link */}
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
          className="pt-4"
        >
          <a
            href="https://github.com/irzix/nestjs-agentic"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 font-mono text-xs text-zinc-400 hover:text-white transition-colors"
          >
            <Github className="w-4 h-4 text-white" />
            <span>github.com/irzix/nestjs-agentic</span>
          </a>
        </motion.div>

      </div>
    </footer>
  );
}
