import type { VaultApi } from '../electron/preload';

declare global {
  interface Window {
    vaultApi: VaultApi;
  }
}

export {};
