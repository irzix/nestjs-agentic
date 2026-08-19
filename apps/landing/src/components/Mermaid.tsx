'use client';

import React, { useEffect, useId, useState } from 'react';
import { useTheme } from 'next-themes';

interface MermaidProps {
  chart: string;
}

export function Mermaid({ chart }: MermaidProps) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, 'm');
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    let isMounted = true;

    async function renderChart() {
      try {
        const mermaid = (await import('mermaid')).default;
        const isDark = resolvedTheme === 'dark' || document.documentElement.classList.contains('dark');

        mermaid.initialize({
          startOnLoad: false,
          theme: isDark ? 'dark' : 'neutral',
          themeVariables: isDark
            ? {
                darkMode: true,
                background: '#09090b',
                primaryColor: '#e0234e',
                primaryTextColor: '#ffffff',
                primaryBorderColor: 'rgba(224, 35, 78, 0.4)',
                lineColor: '#a1a1aa',
                secondaryColor: '#18181b',
                tertiaryColor: '#121215',
                noteBkgColor: '#18181b',
                noteTextColor: '#f4f4f5',
                fontFamily: 'var(--font-sans), system-ui, sans-serif',
              }
            : {
                darkMode: false,
                background: '#ffffff',
                primaryColor: '#e0234e',
                primaryTextColor: '#ffffff',
                primaryBorderColor: '#e0234e',
                lineColor: '#52525b',
                secondaryColor: '#f4f4f5',
                tertiaryColor: '#fafafa',
                noteBkgColor: '#f4f4f5',
                noteTextColor: '#09090b',
                fontFamily: 'var(--font-sans), system-ui, sans-serif',
              },
          securityLevel: 'loose',
        });

        // Decode HTML entities that Rehype may have escaped (e.g. ->> or -->)
        const cleanChart = chart
          .replace(/&gt;/g, '>')
          .replace(/&lt;/g, '<')
          .replace(/&amp;/g, '&')
          .replace(/&quot;/g, '"')
          .trim();

        const { svg: renderedSvg } = await mermaid.render(`svg-${id}`, cleanChart);

        if (isMounted) {
          setSvg(renderedSvg);
          setError(null);
        }
      } catch (err: any) {
        if (isMounted) {
          console.error('Mermaid render error:', err);
          setError(err?.message || 'Failed to render diagram');
        }
      }
    }

    renderChart();

    return () => {
      isMounted = false;
    };
  }, [chart, id, resolvedTheme]);

  if (error) {
    return (
      <div className="my-4 rounded-xl border border-rose-500/30 bg-rose-950/20 p-4 text-xs font-mono text-rose-300">
        <p className="font-semibold mb-1">Diagram Render Error:</p>
        <pre className="whitespace-pre-wrap">{error}</pre>
      </div>
    );
  }

  if (!svg) {
    return (
      <div className="my-6 flex h-48 w-full items-center justify-center rounded-xl border border-zinc-800/60 bg-zinc-900/30">
        <span className="text-xs text-zinc-500 animate-pulse font-mono">Rendering diagram...</span>
      </div>
    );
  }

  return (
    <div
      className="my-6 overflow-x-auto rounded-xl border border-zinc-800/60 bg-zinc-950/40 dark:bg-[#09090b]/80 p-6 flex justify-center shadow-sm"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
