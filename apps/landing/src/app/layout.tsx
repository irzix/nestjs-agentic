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

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://nestjs-agentic.irzix.com';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: 'nestjs-agentic — AI Integration & Governance Layer for NestJS',
    template: '%s | nestjs-agentic',
  },
  description:
    'The official AI integration layer for NestJS. Transform existing backend services into safe, type-safe, policy-guarded AI tools with built-in Human-in-the-Loop approvals.',
  keywords: [
    'NestJS',
    'NestJS AI',
    'NestJS Agents',
    'AI Integration Layer',
    'Function Calling NestJS',
    'ToolSet',
    'ToolPolicy',
    'Human in the Loop',
    'HITL NestJS',
    'Google ADK NestJS',
    'Vercel AI SDK',
    'LangGraph NestJS',
    'Agentic Framework',
    'irzix',
  ],
  authors: [{ name: 'irzix', url: 'https://github.com/irzix' }],
  creator: 'irzix',
  publisher: 'irzix',
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  openGraph: {
    title: 'nestjs-agentic — AI Integration & Governance Layer for NestJS',
    description:
      'Transform existing NestJS backend services into safe, AI-native tools with built-in Human-in-the-Loop approvals.',
    url: siteUrl,
    siteName: 'nestjs-agentic',
    images: [
      {
        url: 'https://raw.githubusercontent.com/irzix/nestjs-agentic/main/docs/assets/banner.jpeg',
        width: 1200,
        height: 630,
        alt: 'nestjs-agentic banner',
      },
    ],
    locale: 'en_US',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'nestjs-agentic — AI Integration & Governance Layer for NestJS',
    description:
      'Transform existing NestJS backend services into safe, AI-native tools with built-in Human-in-the-Loop approvals.',
    images: ['https://raw.githubusercontent.com/irzix/nestjs-agentic/main/docs/assets/banner.jpeg'],
    creator: '@irzix',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  alternates: {
    canonical: siteUrl,
  },
};

const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'SoftwareApplication',
      '@id': `${siteUrl}/#software`,
      name: 'nestjs-agentic',
      description:
        'AI Integration & Governance Layer for NestJS Applications. Expose backend services as safe, type-safe, policy-guarded tools for LLMs.',
      applicationCategory: 'DeveloperApplication',
      operatingSystem: 'Node.js, NestJS',
      programmingLanguage: 'TypeScript',
      author: {
        '@type': 'Person',
        name: 'irzix',
        url: 'https://github.com/irzix',
      },
      offers: {
        '@type': 'Offer',
        price: '0',
        priceCurrency: 'USD',
      },
      license: 'https://opensource.org/licenses/MIT',
      codeRepository: 'https://github.com/irzix/nestjs-agentic',
    },
    {
      '@type': 'WebSite',
      '@id': `${siteUrl}/#website`,
      url: siteUrl,
      name: 'nestjs-agentic',
      description: 'AI Integration & Governance Layer for NestJS',
      publisher: {
        '@type': 'Person',
        name: 'irzix',
      },
    },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`dark ${manrope.variable} ${mono.variable}`}>
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body className="bg-[#000000] text-zinc-100 font-sans">{children}</body>
    </html>
  );
}
