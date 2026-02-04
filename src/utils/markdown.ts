import type { OutlineHeading } from '../types';

const baseSlug = (value: string) => {
  const slug = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'section';
};

export const createSlugger = () => {
  const counts = new Map<string, number>();
  return (value: string) => {
    const base = baseSlug(value);
    const count = counts.get(base) ?? 0;
    counts.set(base, count + 1);
    return count === 0 ? base : `${base}-${count}`;
  };
};

const stripCodeFences = (content: string) => {
  const lines = content.split(/\r?\n/);
  const filtered: { line: string; lineNumber: number }[] = [];
  let inCodeBlock = false;
  lines.forEach((line, index) => {
    const trimmed = line.trimStart();
    if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) {
      inCodeBlock = !inCodeBlock;
      return;
    }
    if (!inCodeBlock) {
      filtered.push({ line, lineNumber: index + 1 });
    }
  });
  return filtered;
};

export const parseHeadings = (content: string): OutlineHeading[] => {
  const slugger = createSlugger();
  const headings: OutlineHeading[] = [];
  const lines = stripCodeFences(content);
  for (const { line, lineNumber } of lines) {
    const match = /^(#{1,6})\s+(.+)$/.exec(line);
    if (!match) {
      continue;
    }
    const level = match[1].length;
    const text = match[2].replace(/\s+#*$/, '').trim();
    if (!text) {
      continue;
    }
    headings.push({
      level,
      text,
      slug: slugger(text),
      line: lineNumber
    });
  }
  return headings;
};
