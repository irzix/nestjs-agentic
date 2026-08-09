'use client';

import React from 'react';
import { HeroSection } from '@/components/Header';
import { SyntaxShowcase } from '@/components/SyntaxShowcase';
import { Pillars } from '@/components/Pillars';
import { Footer } from '@/components/Footer';

export default function LandingPage() {
  return (
    <div className="w-full bg-black text-zinc-100 font-sans selection:bg-rose-600/30 selection:text-rose-200 overflow-x-hidden">
      
      {/* SECTION 1: HERO */}
      <HeroSection />

      {/* SECTION 2: SYNTAX SHOWCASE */}
      <SyntaxShowcase />

      {/* SECTION 3: ARCHITECTURE PILLARS */}
      <Pillars />

      {/* SECTION 4: FOOTER */}
      <Footer />

    </div>
  );
}
