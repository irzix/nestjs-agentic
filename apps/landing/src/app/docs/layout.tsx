import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import type { ReactNode } from 'react';
import { source } from '@/source';

export default function RootDocsLayout({ children }: { children: ReactNode }) {
  return (
    <DocsLayout
      tree={source.pageTree}
      nav={{
        enabled: false,
      }}
      sidebar={{
        defaultOpenLevel: 0,
        banner: (
          <a
            href="/"
            className="flex items-center gap-2 font-bold text-fd-foreground tracking-tight py-2 px-1 hover:opacity-80 transition-opacity"
          >
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500 shadow-[0_0_8px_rgba(224,35,78,0.8)]" />
            <span className="text-sm font-semibold">nestjs-agentic</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-400 border border-rose-500/20 font-mono">
              v1.x
            </span>
          </a>
        ),
      }}
    >
      {children}
    </DocsLayout>
  );
}
