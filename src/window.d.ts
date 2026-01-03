import type { KeyBundle } from "./encryption/key-bundle";

declare global {
  interface Window {
    bluettiKeyBundle: KeyBundle;
  }
}
