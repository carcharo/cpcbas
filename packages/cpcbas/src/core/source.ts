/**
 * Source files, positions and spans: the input side of every stage.
 *
 * The library never touches a file system. The host (CLI, Studio, browser) hands
 * the compiler a {@link FileTree} of virtual paths; every file a compile reads
 * (the main file, includes, runtime asm, generated asm) is registered once in a
 * {@link SourceSet}, which gives it a {@link FileId}. Everything downstream
 * (tokens, AST nodes, diagnostics, assembler errors) points into source text
 * with a {@link Span}: a file id plus two UTF-16 offsets. Line and column are
 * computed from a span only when a person or editor needs them.
 *
 * Conventions:
 * - offsets are 0-based indexes into the JavaScript string (UTF-16 code units);
 * - lines and columns are 1-based; a column counts UTF-16 code units, a tab is
 *   one column; `\r\n`, `\n` and a lone `\r` each end a line;
 * - a span is half-open: `[start, end)`; an empty span (`start === end`) marks a
 *   point, e.g. "expected THEN here".
 * - paths are POSIX-style virtual paths ("games/main.bas", "/lib/runtime/print.asm"),
 *   normalised with {@link normalizePath}; the library never sees `\`.
 */

/** A file's number inside one {@link SourceSet}, in registration order (0 = the first file added). */
export type FileId = number & { readonly __fileId: unique symbol };

/** Makes a {@link FileId} from a number (for tests and for code that stores ids in arrays). */
export function asFileId(n: number): FileId {
  return n as FileId;
}

/** A range of source text: `[start, end)` in UTF-16 offsets of `file`'s text. */
export interface Span {
  readonly file: FileId;
  readonly start: number;
  readonly end: number;
}

/** A resolved point in a file. `line` and `col` are 1-based; `offset` is the 0-based UTF-16 index. */
export interface Position {
  readonly file: FileId;
  readonly line: number;
  readonly col: number;
  readonly offset: number;
}

/** File contents as the host supplies them: text, or bytes (decoded as UTF-8 when read as source). */
export type FileContent = string | Uint8Array;

/**
 * The virtual file tree a compile reads from. A `Map<string, FileContent>` satisfies it;
 * hosts with lazy storage (the LSP, the browser) implement it directly.
 * Keys are normalised paths ({@link normalizePath}).
 */
export interface FileTree {
  get(path: string): FileContent | undefined;
  has(path: string): boolean;
}

/** Where a registered file came from; used for diagnostics wording and for the LSP. */
export type SourceOrigin = 'user' | 'library' | 'runtime' | 'generated';

/** One registered file: its id, normalised path, text, and the offsets where each line starts. */
export interface SourceFile {
  readonly id: FileId;
  readonly path: string;
  readonly text: string;
  readonly origin: SourceOrigin;
  /** `lineStarts[i]` is the offset of the first character of line `i + 1`; `lineStarts[0] === 0`. */
  readonly lineStarts: readonly number[];
}

/** Offsets at which each line of `text` starts (`\r\n`, `\n` and lone `\r` end a line). */
export function computeLineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 13 /* \r */) {
      if (text.charCodeAt(i + 1) === 10) i++;
      starts.push(i + 1);
    } else if (c === 10 /* \n */) {
      starts.push(i + 1);
    }
  }
  return starts;
}

/**
 * The files of one compile (or one LSP snapshot). Registration order fixes the
 * {@link FileId}s, so a deterministic compile registers files in a deterministic order
 * (main file first, then includes in the order they are first met).
 */
export class SourceSet {
  private readonly files: SourceFile[] = [];
  private readonly byPathMap = new Map<string, SourceFile>();

  /** Registers a file (path normalised). Registering the same path again returns the existing file unchanged. */
  add(path: string, text: string, origin: SourceOrigin = 'user'): SourceFile {
    const norm = normalizePath(path);
    const existing = this.byPathMap.get(norm);
    if (existing) return existing;
    const file: SourceFile = {
      id: asFileId(this.files.length),
      path: norm,
      text,
      origin,
      lineStarts: computeLineStarts(text),
    };
    this.files.push(file);
    this.byPathMap.set(norm, file);
    return file;
  }

  get(id: FileId): SourceFile {
    const f = this.files[id];
    if (!f) throw new RangeError(`SourceSet: no file with id ${id}`);
    return f;
  }

  byPath(path: string): SourceFile | undefined {
    return this.byPathMap.get(normalizePath(path));
  }

  /** All files, in id order. */
  all(): readonly SourceFile[] {
    return this.files;
  }

  /** The 1-based line/column of an offset (offsets past the end clamp to the end). */
  position(file: FileId, offset: number): Position {
    const f = this.get(file);
    const off = Math.max(0, Math.min(offset, f.text.length));
    const starts = f.lineStarts;
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((starts[mid] as number) <= off) lo = mid;
      else hi = mid - 1;
    }
    return { file, line: lo + 1, col: off - (starts[lo] as number) + 1, offset: off };
  }

  /** Start and end positions of a span (end is exclusive, like the span). */
  range(span: Span): { start: Position; end: Position } {
    return { start: this.position(span.file, span.start), end: this.position(span.file, span.end) };
  }

  /** The offset of a 1-based line/column, clamped to the file (used for `#line` attribution). */
  offsetAt(file: FileId, line: number, col = 1): number {
    const f = this.get(file);
    const starts = f.lineStarts;
    const li = Math.max(0, Math.min(line - 1, starts.length - 1));
    const lineStart = starts[li] as number;
    const nextStart = li + 1 < starts.length ? (starts[li + 1] as number) : f.text.length;
    return Math.min(lineStart + Math.max(0, col - 1), nextStart);
  }

  /** The text a span covers. */
  text(span: Span): string {
    return this.get(span.file).text.slice(span.start, span.end);
  }
}

/** A span covering `a` through `b` (same file; `b` may be the same span). */
export function joinSpans(a: Span, b: Span): Span {
  return { file: a.file, start: Math.min(a.start, b.start), end: Math.max(a.end, b.end) };
}

/** An empty span at the start of `s` (a point). */
export function spanStart(s: Span): Span {
  return { file: s.file, start: s.start, end: s.start };
}

// ---------------------------------------------------------------------------
// Virtual paths (no node:path in the library)
// ---------------------------------------------------------------------------

/** Normalises a virtual path: `\` to `/`, removes `.` and empty segments, resolves `..` where possible. Keeps a leading `/`. */
export function normalizePath(path: string): string {
  const p = path.replace(/\\/g, '/');
  const absolute = p.startsWith('/');
  const out: string[] = [];
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..' && out.length > 0 && out[out.length - 1] !== '..') out.pop();
    else if (seg === '..' && absolute) continue;
    else out.push(seg);
  }
  const joined = out.join('/');
  return absolute ? `/${joined}` : joined === '' ? '.' : joined;
}

/** The directory part of a normalised path ("a/b/c.bas" -> "a/b"; "c.bas" -> "."; "/c.bas" -> "/"). */
export function dirname(path: string): string {
  const p = normalizePath(path);
  const i = p.lastIndexOf('/');
  if (i < 0) return '.';
  if (i === 0) return '/';
  return p.slice(0, i);
}

/** Joins path segments and normalises; an absolute later segment replaces what came before. */
export function joinPath(...parts: string[]): string {
  let acc = '';
  for (const part of parts) {
    if (part === '') continue;
    const p = part.replace(/\\/g, '/');
    acc = p.startsWith('/') || acc === '' ? p : `${acc}/${p}`;
  }
  return normalizePath(acc === '' ? '.' : acc);
}

// ---------------------------------------------------------------------------
// Text decoding (no TextDecoder in the library's type environment)
// ---------------------------------------------------------------------------

/**
 * File content as source text: strings pass through; bytes are decoded as UTF-8
 * (invalid sequences become U+FFFD; a leading byte-order mark is dropped).
 */
export function decodeText(content: FileContent): string {
  if (typeof content === 'string') return content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
  const b = content;
  let i = b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf ? 3 : 0;
  const parts: string[] = [];
  let chunk: number[] = [];
  const flush = (): void => {
    parts.push(String.fromCharCode(...chunk));
    chunk = [];
  };
  while (i < b.length) {
    const c = b[i] as number;
    let cp = 0xfffd;
    let len = 1;
    if (c < 0x80) cp = c;
    else if (c >= 0xc2 && c < 0xe0 && i + 1 < b.length) {
      const c1 = b[i + 1] as number;
      if ((c1 & 0xc0) === 0x80) {
        cp = ((c & 0x1f) << 6) | (c1 & 0x3f);
        len = 2;
      }
    } else if (c >= 0xe0 && c < 0xf0 && i + 2 < b.length) {
      const c1 = b[i + 1] as number;
      const c2 = b[i + 2] as number;
      const v = ((c & 0x0f) << 12) | ((c1 & 0x3f) << 6) | (c2 & 0x3f);
      if ((c1 & 0xc0) === 0x80 && (c2 & 0xc0) === 0x80 && v >= 0x800 && (v < 0xd800 || v > 0xdfff)) {
        cp = v;
        len = 3;
      }
    } else if (c >= 0xf0 && c < 0xf5 && i + 3 < b.length) {
      const c1 = b[i + 1] as number;
      const c2 = b[i + 2] as number;
      const c3 = b[i + 3] as number;
      const v = ((c & 0x07) << 18) | ((c1 & 0x3f) << 12) | ((c2 & 0x3f) << 6) | (c3 & 0x3f);
      if ((c1 & 0xc0) === 0x80 && (c2 & 0xc0) === 0x80 && (c3 & 0xc0) === 0x80 && v >= 0x10000 && v <= 0x10ffff) {
        cp = v;
        len = 4;
      }
    }
    if (cp > 0xffff) {
      const v = cp - 0x10000;
      chunk.push(0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff));
    } else chunk.push(cp);
    if (chunk.length >= 8192) flush();
    i += len;
  }
  flush();
  return parts.join('');
}
