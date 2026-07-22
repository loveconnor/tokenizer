export interface ConnorsTokenizerVocabularyPiece {
  id: number
  bytes: string
  score: number
  protected?: boolean
}

export interface ConnorsTokenizerControlToken {
  id: number
  surface: string
}

export interface ConnorsTokenizerArtifact {
  schemaVersion: 1
  tokenizerId: string
  modelType: "byte-unigram"
  normalization: "identity"
  vocabulary: ConnorsTokenizerVocabularyPiece[]
  controlTokens: Record<string, ConnorsTokenizerControlToken>
  limits: {
    maxInputBytes: number
    maxPieceBytes: number
  }
}

export type ConnorsTokenizerSegment =
  | { type: "text"; value: string }
  | { type: "control"; name: string }

interface TrieNode {
  children: Map<number, TrieNode>
  tokenId?: number
  score?: number
}

interface DecodedPiece {
  id: number
  bytes: Uint8Array
}

const SCORE_EPSILON = 1e-12

export class ConnorsTokenizer {
  private readonly root: TrieNode = { children: new Map() }
  private readonly pieces = new Map<number, Uint8Array>()
  private readonly controlsByName = new Map<string, ConnorsTokenizerControlToken>()
  private readonly controlsById = new Map<number, ConnorsTokenizerControlToken>()
  private readonly encoder = new TextEncoder()
  private readonly decoder = new TextDecoder()

  static async load(url = "/tokenizers/atlas-unigram-v3/tokenizer.json") {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`Connor’s Tokenizer artifact unavailable (${response.status})`)
    return new ConnorsTokenizer(await response.json() as ConnorsTokenizerArtifact)
  }

  constructor(private readonly artifact: ConnorsTokenizerArtifact) {
    validateArtifact(artifact)
    for (const piece of artifact.vocabulary) {
      const bytes = decodeBase64(piece.bytes)
      this.pieces.set(piece.id, bytes)
      let node = this.root
      for (const byte of bytes) {
        let child = node.children.get(byte)
        if (!child) {
          child = { children: new Map() }
          node.children.set(byte, child)
        }
        node = child
      }
      node.tokenId = piece.id
      node.score = piece.score
    }
    for (const [name, control] of Object.entries(artifact.controlTokens)) {
      this.controlsByName.set(name, control)
      this.controlsById.set(control.id, control)
    }
  }

  encode(text: string): number[] {
    return this.encodeBytes(this.encoder.encode(text)).map((piece) => piece.id)
  }

  encodeDetailed(text: string): DecodedPiece[] {
    return this.encodeBytes(this.encoder.encode(text))
  }

  encodeSegments(segments: readonly ConnorsTokenizerSegment[]): number[] {
    const ids: number[] = []
    for (const segment of segments) {
      if (segment.type === "text") {
        ids.push(...this.encode(segment.value))
        continue
      }
      const control = this.controlsByName.get(segment.name)
      if (!control) throw new Error(`Unknown Connor’s Tokenizer control token: ${segment.name}`)
      ids.push(control.id)
    }
    return ids
  }

  decode(ids: number[], options?: { skip_special_tokens?: boolean }): string {
    const output: string[] = []
    let textBytes: number[] = []
    const flushText = () => {
      if (textBytes.length) output.push(this.decoder.decode(Uint8Array.from(textBytes)))
      textBytes = []
    }
    for (const id of ids) {
      const bytes = this.pieces.get(id)
      if (bytes) {
        textBytes.push(...bytes)
        continue
      }
      const control = this.controlsById.get(id)
      if (!control) throw new Error(`Unknown Connor’s Tokenizer token ID: ${id}`)
      flushText()
      if (!options?.skip_special_tokens) output.push(control.surface)
    }
    flushText()
    return output.join("")
  }

  private encodeBytes(bytes: Uint8Array): DecodedPiece[] {
    if (bytes.length > this.artifact.limits.maxInputBytes) {
      throw new Error(`Connor’s Tokenizer input exceeds ${this.artifact.limits.maxInputBytes.toLocaleString()} UTF-8 bytes`)
    }
    if (bytes.length === 0) return []

    const bestScores = new Float64Array(bytes.length + 1)
    bestScores.fill(Number.NEGATIVE_INFINITY)
    bestScores[0] = 0
    const tokenCounts = new Uint32Array(bytes.length + 1)
    tokenCounts.fill(0xffffffff)
    tokenCounts[0] = 0
    const previousOffsets = new Int32Array(bytes.length + 1)
    previousOffsets.fill(-1)
    const previousIds = new Int32Array(bytes.length + 1)
    previousIds.fill(-1)

    for (let start = 0; start < bytes.length; start += 1) {
      if (!Number.isFinite(bestScores[start])) continue
      let node = this.root
      const limit = Math.min(bytes.length, start + this.artifact.limits.maxPieceBytes)
      for (let end = start; end < limit; end += 1) {
        const child = node.children.get(bytes[end])
        if (!child) break
        node = child
        if (node.tokenId === undefined || node.score === undefined) continue
        const next = end + 1
        const candidateScore = bestScores[start] + node.score
        const candidateCount = tokenCounts[start] + 1
        const scoreDifference = candidateScore - bestScores[next]
        const isBetter = scoreDifference > SCORE_EPSILON
          || (Math.abs(scoreDifference) <= SCORE_EPSILON && candidateCount < tokenCounts[next])
          || (Math.abs(scoreDifference) <= SCORE_EPSILON
            && candidateCount === tokenCounts[next]
            && node.tokenId < previousIds[next])
        if (isBetter) {
          bestScores[next] = candidateScore
          tokenCounts[next] = candidateCount
          previousOffsets[next] = start
          previousIds[next] = node.tokenId
        }
      }
    }

    if (previousOffsets[bytes.length] < 0) {
      throw new Error("Connor’s Tokenizer byte fallback invariant failed")
    }
    const reversed: DecodedPiece[] = []
    for (let offset = bytes.length; offset > 0;) {
      const start = previousOffsets[offset]
      const id = previousIds[offset]
      if (start < 0 || id < 0) throw new Error("Connor’s Tokenizer Viterbi path is incomplete")
      reversed.push({ id, bytes: bytes.slice(start, offset) })
      offset = start
    }
    return reversed.reverse()
  }
}

function validateArtifact(artifact: ConnorsTokenizerArtifact) {
  if (artifact.schemaVersion !== 1 || artifact.modelType !== "byte-unigram" || artifact.normalization !== "identity") {
    throw new Error("Unsupported Connor’s Tokenizer artifact")
  }
  if (!Number.isSafeInteger(artifact.limits.maxInputBytes) || artifact.limits.maxInputBytes <= 0) {
    throw new Error("Invalid Connor’s Tokenizer input limit")
  }
  if (!Number.isSafeInteger(artifact.limits.maxPieceBytes) || artifact.limits.maxPieceBytes <= 0 || artifact.limits.maxPieceBytes > 256) {
    throw new Error("Invalid Connor’s Tokenizer piece limit")
  }
  if (!Array.isArray(artifact.vocabulary) || artifact.vocabulary.length < 256 || artifact.vocabulary.length > 262_144) {
    throw new Error("Invalid Connor’s Tokenizer vocabulary size")
  }
  if (Object.keys(artifact.controlTokens).length > 64) throw new Error("Too many Connor’s Tokenizer control tokens")
  const ids = new Set<number>()
  const byteKeys = new Set<string>()
  for (const piece of artifact.vocabulary) {
    const bytes = decodeBase64(piece.bytes)
    if (!Number.isSafeInteger(piece.id) || piece.id < 0 || ids.has(piece.id)) throw new Error("Invalid or duplicate Connor’s Tokenizer token ID")
    if (!Number.isFinite(piece.score)) throw new Error("Invalid Connor’s Tokenizer token score")
    if (bytes.length === 0 || bytes.length > artifact.limits.maxPieceBytes) throw new Error("Invalid Connor’s Tokenizer token bytes")
    const key = Array.from(bytes).join(",")
    if (byteKeys.has(key)) throw new Error("Duplicate Connor’s Tokenizer byte piece")
    ids.add(piece.id)
    byteKeys.add(key)
  }
  for (let value = 0; value < 256; value += 1) {
    if (!byteKeys.has(String(value))) throw new Error(`Connor’s Tokenizer artifact is missing byte fallback ${value}`)
  }
  for (const control of Object.values(artifact.controlTokens)) {
    if (!Number.isSafeInteger(control.id) || control.id < 0 || ids.has(control.id)) throw new Error("Connor’s Tokenizer control ID overlaps text vocabulary")
    if (!control.surface) throw new Error("Connor’s Tokenizer control surface is empty")
    ids.add(control.id)
  }
}

function decodeBase64(value: string) {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}
