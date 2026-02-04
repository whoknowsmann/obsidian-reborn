import { contextBridge, ipcRenderer } from 'electron';

const api = {
  getLastVault: () => ipcRenderer.invoke('vault:getLast'),
  selectVault: () => ipcRenderer.invoke('vault:select'),
  setVault: (vaultPath: string) => ipcRenderer.invoke('vault:set', vaultPath),
  getTree: () => ipcRenderer.invoke('vault:getTree'),
  readFile: (filePath: string) => ipcRenderer.invoke('file:read', filePath),
  writeFile: (filePath: string, content: string) => ipcRenderer.invoke('file:write', filePath, content),
  createFile: (targetPath: string, content?: string) => ipcRenderer.invoke('file:create', targetPath, content),
  createFolder: (targetPath: string) => ipcRenderer.invoke('folder:create', targetPath),
  renameEntry: (sourcePath: string, targetPath: string) => ipcRenderer.invoke('entry:rename', sourcePath, targetPath),
  prepareRenameEntry: (sourcePath: string, targetPath: string) =>
    ipcRenderer.invoke('entry:prepareRename', sourcePath, targetPath),
  applyRenameEntry: (sourcePath: string, targetPath: string) =>
    ipcRenderer.invoke('entry:applyRename', sourcePath, targetPath),
  deleteEntry: (targetPath: string) => ipcRenderer.invoke('entry:delete', targetPath),
  search: (query: string) => ipcRenderer.invoke('search:query', query),
  quickSwitch: (query: string) => ipcRenderer.invoke('note:quickSwitch', query),
  getTagSummary: () => ipcRenderer.invoke('tags:getSummary'),
  getNotesForTag: (tag: string) => ipcRenderer.invoke('tags:getNotes', tag),
  openByTitle: (title: string) => ipcRenderer.invoke('note:openByTitle', title),
  noteExists: (title: string) => ipcRenderer.invoke('note:exists', title),
  getBacklinks: (filePath: string) => ipcRenderer.invoke('backlinks:get', filePath),
  getLocalGraph: (filePath: string) => ipcRenderer.invoke('graph:local', filePath),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (settings: Record<string, unknown>) =>
    ipcRenderer.invoke('settings:update', settings),
  hasDailyFolder: () => ipcRenderer.invoke('vault:hasDailyFolder'),
  onVaultChanged: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('vault:changed', handler);
    return () => ipcRenderer.removeListener('vault:changed', handler);
  }
};

contextBridge.exposeInMainWorld('vaultApi', api);

export type VaultApi = typeof api;
