import { source } from '@/source';
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
} from 'fumadocs-ui/page';
import { notFound } from 'next/navigation';
import defaultMdxComponents from 'fumadocs-ui/mdx';
import { Mermaid } from '@/components/Mermaid';

function extractRawCode(node: any): string {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);

  if (Array.isArray(node)) {
    return node.map(extractRawCode).join('');
  }

  if (node?.props) {
    const isLine = typeof node.props.className === 'string' && node.props.className.includes('line');
    const inner = extractRawCode(node.props.children);
    return isLine ? `${inner}\n` : inner;
  }

  return '';
}

function CustomPre(props: any) {
  const lang = props?.['data-language'] || props?.['data-lang'] || '';
  const rawText = extractRawCode(props?.children);
  const trimmed = rawText.trim();

  const isMermaid =
    lang === 'mermaid' ||
    props?.className?.includes('language-mermaid') ||
    trimmed.startsWith('flowchart') ||
    trimmed.startsWith('graph') ||
    trimmed.startsWith('sequenceDiagram') ||
    trimmed.startsWith('stateDiagram') ||
    trimmed.startsWith('classDiagram') ||
    trimmed.startsWith('erDiagram') ||
    trimmed.startsWith('gantt') ||
    trimmed.startsWith('pie') ||
    trimmed.startsWith('gitGraph') ||
    trimmed.startsWith('journey');

  if (isMermaid) {
    return <Mermaid chart={trimmed} />;
  }

  const DefaultPre = defaultMdxComponents.pre;
  return DefaultPre ? <DefaultPre {...props} /> : <pre {...props} />;
}

export default async function Page(props: {
  params: Promise<{ slug?: string[] }>;
}) {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  const MDX = page.data.body;

  return (
    <DocsPage toc={page.data.toc} full={page.data.full}>
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription>{page.data.description}</DocsDescription>
      <DocsBody>
        <MDX
          components={{
            ...defaultMdxComponents,
            pre: CustomPre,
            Mermaid,
          }}
        />
      </DocsBody>
    </DocsPage>
  );
}

export async function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata(props: {
  params: Promise<{ slug?: string[] }>;
}) {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  return {
    title: `${page.data.title} | nestjs-agentic Documentation`,
    description: page.data.description,
  };
}
