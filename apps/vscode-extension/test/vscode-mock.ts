import { promises as fs } from 'node:fs';
import path from 'node:path';

/**
 * A minimal stand-in for the `vscode` module.
 *
 * Only the surface `src/tools.ts` actually touches, backed by a real temporary
 * directory — so a write test proves a file appeared on disk, not that a spy
 * was called. Anything the tools do not use is deliberately absent: a mock that
 * quietly answers calls the real API would reject hides bugs rather than
 * catching them.
 */

export class Uri {
  private constructor(readonly path: string) {}

  static file(value: string): Uri {
    return new Uri(value);
  }

  static parse(value: string): Uri {
    return new Uri(value.replace(/^[a-z-]+:/i, ''));
  }

  static joinPath(base: Uri, ...segments: string[]): Uri {
    // path.join normalises "..", which is exactly what the containment check in
    // tools.ts relies on to catch an escape after resolution.
    return new Uri(path.join(base.path, ...segments));
  }

  get fsPath(): string {
    return this.path;
  }

  toString(): string {
    return this.path;
  }
}

export enum FileType {
  Unknown = 0,
  File = 1,
  Directory = 2,
  SymbolicLink = 64,
}

let root: string | null = null;
export function setRoot(value: string | null): void {
  root = value;
}

/** Files opened via showTextDocument, so a test can assert the editor reacted. */
export const opened: string[] = [];

export const workspace = {
  get workspaceFolders() {
    return root ? [{ uri: Uri.file(root), name: 'test', index: 0 }] : undefined;
  },

  fs: {
    async readFile(uri: Uri): Promise<Uint8Array> {
      return new Uint8Array(await fs.readFile(uri.path));
    },
    /**
     * Mirrors the real API precisely: it does NOT create missing parents.
     *
     * The editor's `writeFile` throws when the parent directory is absent —
     * only `createDirectory` has mkdirp semantics. An earlier version of this
     * mock created parents itself, which made "write a file into a new folder"
     * pass here and fail in the editor. A mock that is kinder than the thing it
     * stands in for is worse than no mock.
     */
    async writeFile(uri: Uri, content: Uint8Array): Promise<void> {
      const parent = path.dirname(uri.path);
      try {
        await fs.access(parent);
      } catch {
        const error = new Error(`FileNotFound: ${parent}`);
        error.name = 'FileNotFound';
        throw error;
      }
      await fs.writeFile(uri.path, content);
    },

    /** Has mkdirp semantics, as documented on the real API. */
    async createDirectory(uri: Uri): Promise<void> {
      await fs.mkdir(uri.path, { recursive: true });
    },
    async readDirectory(uri: Uri): Promise<[string, FileType][]> {
      const entries = await fs.readdir(uri.path, { withFileTypes: true });
      return entries.map((entry) => [
        entry.name,
        entry.isDirectory() ? FileType.Directory : FileType.File,
      ]);
    },
  },

  async findFiles(_include: string, _exclude: string, max: number): Promise<Uri[]> {
    const found: Uri[] = [];
    async function walk(dir: string): Promise<void> {
      if (found.length >= max) return;
      for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(full);
        else if (found.length < max) found.push(Uri.file(full));
      }
    }
    if (root) await walk(root);
    return found;
  },

  asRelativePath(uri: Uri): string {
    return root ? path.relative(root, uri.path) : uri.path;
  },

  async openTextDocument(uri: Uri) {
    return { uri };
  },
};

export const window = {
  async showTextDocument(document: { uri: Uri }) {
    opened.push(document.uri.path);
    return document;
  },
};

export const commands = {
  async executeCommand(): Promise<void> {},
};
