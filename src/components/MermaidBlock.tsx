import { useEffect, useId, useState } from 'react';
import mermaid from 'mermaid';
import type { ThemeMode } from '../types';

type MermaidBlockProps = {
  code: string;
  themeMode: ThemeMode;
};

const MermaidBlock = ({ code, themeMode }: MermaidBlockProps) => {
  const id = useId();
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const renderDiagram = async () => {
      try {
        mermaid.initialize({
          startOnLoad: false,
          theme: themeMode === 'dark' ? 'dark' : 'default'
        });
        const { svg: renderedSvg } = await mermaid.render(`mermaid-${id}`, code);
        if (cancelled) {
          return;
        }
        setSvg(renderedSvg);
        setError(null);
      } catch (renderError) {
        if (cancelled) {
          return;
        }
        setSvg('');
        setError(renderError instanceof Error ? renderError.message : 'Unable to render Mermaid diagram.');
      }
    };
    renderDiagram();
    return () => {
      cancelled = true;
    };
  }, [code, id, themeMode]);

  if (error) {
    return (
      <pre className="mermaid-error">
        Mermaid error: {error}
      </pre>
    );
  }

  return <div className="mermaid-diagram" dangerouslySetInnerHTML={{ __html: svg }} />;
};

export default MermaidBlock;
