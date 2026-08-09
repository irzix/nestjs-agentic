import type { Metadata } from 'next';
import { Manrope, JetBrains_Mono } from 'next/font/google';
import './globals.css';

const manrope = Manrope({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
  weight: ['400', '500', '600', '700', '800'],
});

const mono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'nestjs-agentic — AI Integration & Governance Layer for NestJS',
  description: 'Transform existing NestJS backend services into safe, AI-native tools with built-in Human-in-the-Loop approvals.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`dark ${manrope.variable} ${mono.variable}`}>
      <body className="bg-[#030102] text-zinc-100 font-sans">{children}</body>
    </html>
  );
}
