const wikiRegex = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

export const normalizeTitle = (value: string) => value.trim().toLowerCase();

export const noteTitleFromPath = (filePath: string) => {
  const parts = filePath.split(/[/\\]/);
  const fileName = parts[parts.length - 1];
  return fileName.replace(/\.md$/i, '');
};

export const getParentFolder = (filePath: string) => filePath.split(/[/\\]/).slice(0, -1).join('/');

export const isAbsolutePath = (value: string) => value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value);

export const formatDailyTitle = (date = new Date()) => date.toISOString().slice(0, 10);

export const convertWikiLinks = (content: string) =>
  content.replace(wikiRegex, (_match, target, alias) => {
    const label = alias ?? target;
    return `[${label}](wikilink:${encodeURIComponent(target)})`;
  });
