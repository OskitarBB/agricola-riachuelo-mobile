// tools/verificacion/mocks/expo-file-system.ts — API nueva del SDK 57 (File, Directory, Paths) sobre el disco local;
// File.upload hace el multipart con fetch (como el nativo: los `parameters` y el archivo en `fieldName`).
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as nodePath from 'node:path';

const ROOT = process.env.RIACHUELO_ARCHIVOS ?? '/tmp/riachuelo-verificacion/archivos';
const toPath = (uri: string) => uri.replace(/^file:\/\//, '');
const join = (...parts: unknown[]) =>
  'file://' +
  nodePath.join(...parts.map((p) => (typeof p === 'string' ? p : (p as { uri: string }).uri).replace(/^file:\/\//, '')));

export enum FileMode { ReadOnly = 'r', WriteOnly = 'w', ReadWrite = 'rw', Append = 'a', Truncate = 't' }
export type FileHandle = unknown;
export enum UploadType { BINARY_CONTENT = 0, MULTIPART = 1 }

export class File {
  uri: string;
  constructor(...parts: unknown[]) {
    this.uri = join(...parts);
  }
  get name() { return nodePath.basename(toPath(this.uri)); }
  get exists() { return fs.existsSync(toPath(this.uri)) && fs.statSync(toPath(this.uri)).isFile(); }
  get size() { return fs.statSync(toPath(this.uri)).size; }
  get md5() { return this.exists ? createHash('md5').update(fs.readFileSync(toPath(this.uri))).digest('hex') : null; }
  get modificationTime() { return fs.statSync(toPath(this.uri)).mtimeMs; }
  create(_o?: unknown) { fs.mkdirSync(nodePath.dirname(toPath(this.uri)), { recursive: true }); fs.writeFileSync(toPath(this.uri), ''); }
  write(data: string | Uint8Array) { fs.mkdirSync(nodePath.dirname(toPath(this.uri)), { recursive: true }); fs.writeFileSync(toPath(this.uri), data); }
  textSync() { return fs.readFileSync(toPath(this.uri), 'utf8'); }
  bytesSync() { return new Uint8Array(fs.readFileSync(toPath(this.uri))); }
  delete() { fs.rmSync(toPath(this.uri)); }
  open(_mode?: FileMode) {
    const p = toPath(this.uri);
    return {
      writeBytes: (chunk: Uint8Array) => fs.appendFileSync(p, chunk),
      close: () => undefined,
    };
  }
  moveSync(dest: File) { fs.mkdirSync(nodePath.dirname(toPath(dest.uri)), { recursive: true }); fs.renameSync(toPath(this.uri), toPath(dest.uri)); this.uri = dest.uri; }
  copySync(dest: File) { fs.mkdirSync(nodePath.dirname(toPath(dest.uri)), { recursive: true }); fs.copyFileSync(toPath(this.uri), toPath(dest.uri)); }
  async upload(url: string, opts: {
    httpMethod?: string; uploadType?: UploadType; fieldName?: string; mimeType?: string; parameters?: Record<string, string>;
    headers?: Record<string, string>; onProgress?: (p: { bytesSent: number; totalBytes: number }) => void; signal?: AbortSignal;
  } = {}) {
    const bytes = fs.readFileSync(toPath(this.uri)); // lanza si el archivo no existe (como el nativo)
    let payload: FormData | Uint8Array;
    if (opts.uploadType === UploadType.BINARY_CONTENT) {
      payload = new Uint8Array(bytes); // cuerpo binario (envío cámara → controlador, §14.8)
    } else {
      const form = new FormData();
      for (const [k, v] of Object.entries(opts.parameters ?? {})) form.append(k, v);
      form.append(opts.fieldName ?? 'file', new Blob([bytes], { type: opts.mimeType ?? 'application/octet-stream' }), this.name);
      payload = form;
    }
    opts.onProgress?.({ bytesSent: 0, totalBytes: bytes.length });
    const res = await fetch(url, { method: opts.httpMethod ?? 'POST', headers: opts.headers, body: payload, signal: opts.signal });
    const body = await res.text();
    opts.onProgress?.({ bytesSent: bytes.length, totalBytes: bytes.length });
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => { headers[k] = v; });
    return { status: res.status, body, headers };
  }
}

export class Directory extends File {
  get exists() { return fs.existsSync(toPath(this.uri)) && fs.statSync(toPath(this.uri)).isDirectory(); }
  create(_o?: unknown) { fs.mkdirSync(toPath(this.uri), { recursive: true }); }
  delete() { fs.rmSync(toPath(this.uri), { recursive: true, force: true }); }
  list(): (File | Directory)[] {
    return fs.readdirSync(toPath(this.uri), { withFileTypes: true }).map((d) =>
      d.isDirectory() ? new Directory(this.uri, d.name) : new File(this.uri, d.name),
    );
  }
}

export const Paths = {
  document: new Directory(`file://${ROOT}/document`),
  cache: new Directory(`file://${ROOT}/cache`),
  availableDiskSpace: 50 * 1024 ** 3,
};
