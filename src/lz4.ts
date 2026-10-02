//lz4 block codec. the compressor is a line by line port of LZ4_compress_default (lz4.c 1.9.x)
//so it spits out the same bytes as liblz4, checked in test/lz4.test.ts. block format only, no frame

const MINMATCH = 4
const LASTLITERALS = 5
const MFLIMIT = 12
const LZ4_MIN_LENGTH = MFLIMIT + 1
const ML_BITS = 4
const ML_MASK = (1 << ML_BITS) - 1
const RUN_MASK = (1 << (8 - ML_BITS)) - 1
const LZ4_HASHLOG = 12 //from LZ4_MEMORY_USAGE 14 - 2
const LZ4_SKIP_TRIGGER = 6
const LZ4_DISTANCE_MAX = 65535
//below this liblz4 uses the 16-bit table
const LZ4_64K_LIMIT = 65536 + (MFLIMIT - 1)
const PRIME32 = 2654435761
//prime5bytes (889523592379) split in 32-bit halves
const PRIME5_HI = 0xcf
const PRIME5_LO = 0x1bbcdcbb

//same as LZ4_compressBound
export function compressBound(inputSize: number): number {
  return inputSize + Math.floor(inputSize / 255) + 16
}

function read32(b: Uint8Array, i: number): number {
  return (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0
}

export interface Lz4Options {
  //like LZ4_compress_fast, default 1
  acceleration?: number
  //auto = LZ4_compress_default (16-bit table + 4-byte hash under 64kb)
  //u32 = the streaming api, python-lz4 uses it. ~1% different sizes, same format
  table?: 'auto' | 'u32'
}

export function compressBlock(src: Uint8Array, opts: Lz4Options = {}): Uint8Array {
  const out = new Uint8Array(compressBound(src.length))
  const n = compressBlockInto(src, out, opts)
  return out.slice(0, n)
}

//just the size, reuses a scratch buffer
export function compressedSize(src: Uint8Array, opts: Lz4Options = {}): number {
  return compressBlockInto(src, scratchFor(src.length), opts)
}

let scratch = new Uint8Array(0)
function scratchFor(n: number): Uint8Array {
  const need = compressBound(n)
  if (scratch.length < need) scratch = new Uint8Array(need)
  return scratch
}

//dst needs compressBound(src.length) bytes
export function compressBlockInto(src: Uint8Array, dst: Uint8Array, opts: Lz4Options = {}): number {
  const inputSize = src.length
  const acceleration = Math.max(1, Math.floor(opts.acceleration ?? 1))
  const byU16 = (opts.table ?? 'auto') === 'auto' && inputSize < LZ4_64K_LIMIT
  const hashLog = byU16 ? LZ4_HASHLOG + 1 : LZ4_HASHLOG
  const table = byU16 ? new Uint16Array(1 << hashLog) : new Uint32Array(1 << hashLog)
  //same as LZ4_hashPosition on 64-bit little endian
  const hashAt = byU16
    ? (p: number) => Math.imul(read32(src, p), PRIME32) >>> (32 - hashLog)
    : (p: number) => hash5(src, p, hashLog)

  let ip = 0
  let anchor = 0
  let op = 0
  const iend = inputSize
  const mflimitPlusOne = iend - MFLIMIT + 1
  const matchlimit = iend - LASTLITERALS
  let match = 0

  if (inputSize < LZ4_MIN_LENGTH) return lastLiterals()

  table[hashAt(ip)] = ip
  ip++
  let forwardH = hashAt(ip)

  for (;;) {
    //find a match
    {
      let forwardIp = ip
      let step = 1
      let searchMatchNb = acceleration << LZ4_SKIP_TRIGGER
      for (;;) {
        const h = forwardH
        const current = forwardIp
        const matchIndex = table[h]
        ip = forwardIp
        forwardIp += step
        step = searchMatchNb++ >> LZ4_SKIP_TRIGGER
        if (forwardIp > mflimitPlusOne) return lastLiterals()
        match = matchIndex
        forwardH = hashAt(forwardIp)
        table[h] = current
        if (!byU16 && matchIndex + LZ4_DISTANCE_MAX < current) continue
        if (read32(src, match) === read32(src, ip)) break
      }
    }

    //catch up
    while (ip > anchor && match > 0 && src[ip - 1] === src[match - 1]) {
      ip--
      match--
    }

    //literals
    let token: number
    {
      const litLength = ip - anchor
      token = op++
      if (litLength >= RUN_MASK) {
        let len = litLength - RUN_MASK
        dst[token] = RUN_MASK << ML_BITS
        for (; len >= 255; len -= 255) dst[op++] = 255
        dst[op++] = len
      } else {
        dst[token] = litLength << ML_BITS
      }
      dst.set(src.subarray(anchor, ip), op)
      op += litLength
    }

    for (;;) {
      //offset
      const offset = ip - match
      dst[op++] = offset & 0xff
      dst[op++] = offset >>> 8

      //match length
      {
        let matchCode = count(src, ip + MINMATCH, match + MINMATCH, matchlimit)
        ip += matchCode + MINMATCH
        if (matchCode >= ML_MASK) {
          dst[token] += ML_MASK
          matchCode -= ML_MASK
          for (; matchCode >= 255; matchCode -= 255) dst[op++] = 255
          dst[op++] = matchCode
        } else {
          dst[token] += matchCode
        }
      }
      anchor = ip

      //end of chunk?
      if (ip >= mflimitPlusOne) return lastLiterals()

      //fill table
      table[hashAt(ip - 2)] = ip - 2

      //try the next position right away
      const h = hashAt(ip)
      const current = ip
      const matchIndex = table[h]
      match = matchIndex
      table[h] = current
      if ((byU16 || matchIndex + LZ4_DISTANCE_MAX >= current) && read32(src, match) === read32(src, ip)) {
        token = op++
        dst[token] = 0
        continue
      }
      break
    }

    forwardH = hashAt(++ip)
  }

  function lastLiterals(): number {
    const lastRun = iend - anchor
    if (lastRun >= RUN_MASK) {
      let acc = lastRun - RUN_MASK
      dst[op++] = RUN_MASK << ML_BITS
      for (; acc >= 255; acc -= 255) dst[op++] = 255
      dst[op++] = acc
    } else {
      dst[op++] = lastRun << ML_BITS
    }
    dst.set(src.subarray(anchor, iend), op)
    op += lastRun
    return op
  }
}

function count(b: Uint8Array, pIn: number, pMatch: number, pInLimit: number): number {
  const start = pIn
  while (pIn < pInLimit && b[pIn] === b[pMatch]) {
    pIn++
    pMatch++
  }
  return pIn - start
}

//hash5 with 32-bit math, only bytes p..p+4 matter and we only need the high word
function hash5(b: Uint8Array, p: number, hashLog: number): number {
  const lo = b[p] << 24 //low word of seq << 24
  const hi = (b[p + 1] | (b[p + 2] << 8) | (b[p + 3] << 16) | (b[p + 4] << 24)) >>> 0
  const carry = Math.floor((b[p] * PRIME5_LO) / 256) //high word of lo * PRIME5_LO
  const top = (Math.imul(hi, PRIME5_LO) + Math.imul(lo, PRIME5_HI) + carry) >>> 0
  return top >>> (32 - hashLog)
}

//throws if it'd go past maxOutput
export function decompressBlock(src: Uint8Array, maxOutput: number): Uint8Array {
  const out = new Uint8Array(maxOutput)
  let ip = 0
  let op = 0
  while (ip < src.length) {
    const token = src[ip++]
    let lit = token >>> 4
    if (lit === 15) {
      let b: number
      do {
        b = src[ip++]
        lit += b
      } while (b === 255)
    }
    if (op + lit > maxOutput || ip + lit > src.length) throw new Error('lz4: literal run out of bounds')
    out.set(src.subarray(ip, ip + lit), op)
    ip += lit
    op += lit
    if (ip >= src.length) break
    const offset = src[ip] | (src[ip + 1] << 8)
    ip += 2
    if (offset === 0 || offset > op) throw new Error('lz4: bad offset')
    let len = (token & 15) + MINMATCH
    if ((token & 15) === 15) {
      let b: number
      do {
        b = src[ip++]
        len += b
      } while (b === 255)
    }
    if (op + len > maxOutput) throw new Error('lz4: match out of bounds')
    for (let k = 0; k < len; k++, op++) out[op] = out[op - offset]
  }
  return out.slice(0, op)
}
