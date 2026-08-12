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

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://agentic.alireza.work/';

const productTitle = 'nestjs-agentic — NestJS-native runtime for governed AI agents';
const productDescription =
  'Define agents and tools with NestJS, enforce policy before side effects, and keep model integrations replaceable. Core primitives are available; adapters and optional capabilities are experimental.';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: productTitle,
    template: '%s | nestjs-agentic',
  },
  description: productDescription,
  keywords: [
    'NestJS',
    'NestJS AI Agents',
    'Governed AI Agents',
    'NestJS Runtime',
    'NestJS Dependency Injection',
    'AI Tool Governance',
    'Human in the Loop',
    'HITL NestJS',
    'Google ADK Adapter Prototype',
    'LangGraph Compatibility',
    'Agent Testing',
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
    title: productTitle,
    description: productDescription,
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
    title: productTitle,
    description: productDescription,
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
      description: productDescription,
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
      description: 'The NestJS-native runtime for governed AI agents',
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
        <meta name="google-site-verification" content="Pn9iwq4ZmlEOfWnel04fFMcPJNusg3wZM6HMW20N4MM" />
      </head>
      <body className="bg-[#000000] text-zinc-100 font-sans">{children}</body>
    </html>
  );
}
