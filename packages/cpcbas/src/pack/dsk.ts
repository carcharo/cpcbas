/**
 * Standard CPCEMU `.dsk` writer for the AMSDOS Data format (40 tracks, 1 side, 9 x 512-byte
 * sectors, 1 KB blocks, 64 directory entries). Byte-identical to the fork's `tools/cpc/mkdsk.py`
 * `DiskImage` when the creator is `"mkdsk.py"`.
 */
import { AMSDOS_HEADER_SIZE, amsdosNameParts, buildAmsdosHeader } from './amsdos.js';
import type { BuildDskFn, DskFile, PackResult } from './types.js';
import { AMSDOS_BINARY } from './types.js';

const TRACKS = 40;
const SECTORS_PER_TRACK = 9;
const SECTOR_SIZE = 512;
const FIRST_SECTOR_ID = 0xc1;
const GAP3 = 0x4e;
const FILLER = 0xe5;
const SKEW = [0, 5, 1, 6, 2, 7, 3, 8, 4] as const;
const BLOCK_SIZE = 1024;
const DIR_ENTRY_SIZE = 32;
const DIR_ENTRIES = 64;
const DIR_BLOCKS = 2;
const EXTENT_BLOCKS = 16;
const RECORD_SIZE = 128;
const RECORDS_PER_EXTENT = (EXTENT_BLOCKS * BLOCK_SIZE) / RECORD_SIZE;
const TOTAL_BLOCKS = (TRACKS * SECTORS_PER_TRACK * SECTOR_SIZE) / BLOCK_SIZE; // 180
const MAX_DATA_BYTES = (TOTAL_BLOCKS - DIR_BLOCKS) * BLOCK_SIZE;
const TRACK_HEADER = 0x100;
const TRACK_SIZE = TRACK_HEADER + SECTORS_PER_TRACK * SECTOR_SIZE;
const DISK_INFO_IDENT = 'MV - CPCEMU Disk-File\r\nDisk-Info\r\n';
const TRACK_INFO_IDENT = 'Track-Info\r\n';

const ascii = (s: string): number[] => Array.from(s, (c) => c.charCodeAt(0));

export const buildDsk: BuildDskFn = (files, options) => {
  const creator = options?.creator ?? 'cpcbas';
  // eslint-disable-next-line no-control-regex
  if (creator.length > 14 || !/^[\x00-\x7f]*$/.test(creator)) {
    return { ok: false, error: { code: 'E603', message: `the disc creator ${JSON.stringify(creator)} must be at most 14 ASCII characters` } };
  }

  const disk = new Uint8Array(TOTAL_BLOCKS * BLOCK_SIZE).fill(FILLER); // logical sector order
  const directory = new Uint8Array(DIR_ENTRIES * DIR_ENTRY_SIZE).fill(FILLER);
  let nextBlock = DIR_BLOCKS;
  let nextEntry = 0;

  for (const file of files) {
    const added = addFile(file, disk, directory, nextBlock, nextEntry);
    if (!added.ok) return added;
    nextBlock += added.value.blocks;
    nextEntry += added.value.extents;
  }
  disk.set(directory, 0);

  const out = new Uint8Array(TRACK_HEADER + TRACKS * TRACK_SIZE);
  const dv = new DataView(out.buffer);
  out.set(ascii(DISK_INFO_IDENT), 0);
  out.set(ascii(creator), 0x22);
  out[0x30] = TRACKS;
  out[0x31] = 1;
  dv.setUint16(0x32, TRACK_SIZE, true);
  for (let track = 0; track < TRACKS; track++) {
    const t = TRACK_HEADER + track * TRACK_SIZE;
    out.set(ascii(TRACK_INFO_IDENT), t);
    out[t + 0x10] = track;
    out[t + 0x14] = 2;
    out[t + 0x15] = SECTORS_PER_TRACK;
    out[t + 0x16] = GAP3;
    out[t + 0x17] = FILLER;
    SKEW.forEach((logical, slot) => {
      const e = t + 0x18 + slot * 8;
      out[e] = track;
      out[e + 2] = FIRST_SECTOR_ID + logical;
      out[e + 3] = 2;
      dv.setUint16(e + 6, SECTOR_SIZE, true);
      const src = (track * SECTORS_PER_TRACK + logical) * SECTOR_SIZE;
      out.set(disk.subarray(src, src + SECTOR_SIZE), t + TRACK_HEADER + slot * SECTOR_SIZE);
    });
  }
  return { ok: true, value: out };
};

function addFile(file: DskFile, disk: Uint8Array, directory: Uint8Array, nextBlock: number, nextEntry: number): PackResult<{ blocks: number; extents: number }> {
  const parts = amsdosNameParts(file.name);
  if (!parts.ok) return parts;
  const user = file.user ?? 0;

  let content: Uint8Array;
  if ((file.header ?? 'amsdos') === 'amsdos') {
    const load = file.loadAddress ?? 0;
    const header = buildAmsdosHeader({
      name: file.name,
      length: file.data.length,
      loadAddress: load,
      entryAddress: file.entryAddress ?? load,
      user,
      fileType: file.fileType ?? AMSDOS_BINARY,
    });
    if (!header.ok) return header;
    content = new Uint8Array(AMSDOS_HEADER_SIZE + file.data.length);
    content.set(header.value, 0);
    content.set(file.data, AMSDOS_HEADER_SIZE);
  } else {
    content = file.data;
  }

  const blocksNeeded = Math.max(Math.ceil(content.length / BLOCK_SIZE), 1);
  const extentsNeeded = Math.max(Math.ceil(blocksNeeded / EXTENT_BLOCKS), 1);
  if (nextBlock + blocksNeeded > TOTAL_BLOCKS) {
    const remain = TOTAL_BLOCKS - nextBlock;
    return {
      ok: false,
      error: {
        code: 'E600',
        message: `${file.name}: disk full: needs ${blocksNeeded} blocks (${content.length} bytes with header) but only ${remain * BLOCK_SIZE} bytes (${remain} blocks) remain of ${MAX_DATA_BYTES} bytes total data capacity`,
      },
    };
  }
  if (nextEntry + extentsNeeded > DIR_ENTRIES) {
    return {
      ok: false,
      error: { code: 'E600', message: `${file.name}: disk full: needs ${extentsNeeded} directory entries but only ${DIR_ENTRIES - nextEntry} remain of ${DIR_ENTRIES} total` },
    };
  }

  disk.set(content, nextBlock * BLOCK_SIZE);
  disk.fill(0, nextBlock * BLOCK_SIZE + content.length, (nextBlock + blocksNeeded) * BLOCK_SIZE);

  let records = Math.ceil(content.length / RECORD_SIZE);
  for (let ex = 0; ex < extentsNeeded; ex++) {
    const rc = Math.min(records, RECORDS_PER_EXTENT);
    records -= rc;
    const e = (nextEntry + ex) * DIR_ENTRY_SIZE;
    directory.fill(0, e, e + DIR_ENTRY_SIZE);
    directory[e] = user;
    directory.set(parts.value.base, e + 1);
    directory.set(parts.value.ext, e + 9);
    directory[e + 0x0c] = ex & 0xff;
    directory[e + 0x0e] = (ex >> 5) & 0xff;
    directory[e + 0x0f] = rc;
    for (let i = 0; i < EXTENT_BLOCKS; i++) {
      const b = ex * EXTENT_BLOCKS + i;
      if (b < blocksNeeded) directory[e + 0x10 + i] = nextBlock + b;
    }
  }
  return { ok: true, value: { blocks: blocksNeeded, extents: extentsNeeded } };
}
