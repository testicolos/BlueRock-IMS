const MAX_EVIDENCE_LENGTH = 3_500_000;

// Require an inline, canonical base64 image with the matching file signature.
// This rejects URLs and placeholder text; camera provenance is enforced by the
// capture UI, because a browser request cannot prove that a photo was taken live.
export function isInlineCapturedImage(value: string | undefined): boolean {
  if (!value || value.length > MAX_EVIDENCE_LENGTH) return false;
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) return false;
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.toString('base64') !== match[2]) return false;

  if (match[1] === 'jpeg') {
    return bytes.length >= 12 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;
  }
  if (match[1] === 'png') {
    return bytes.length >= 45 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      && bytes.readUInt32BE(8) === 13 && bytes.toString('ascii', 12, 16) === 'IHDR'
      && bytes.readUInt32BE(16) > 0 && bytes.readUInt32BE(20) > 0
      && bytes.toString('ascii', bytes.length - 8, bytes.length - 4) === 'IEND';
  }
  return bytes.length >= 30 && bytes.toString('ascii', 0, 4) === 'RIFF'
    && bytes.readUInt32LE(4) === bytes.length - 8 && bytes.toString('ascii', 8, 12) === 'WEBP'
    && ['VP8 ', 'VP8L', 'VP8X'].includes(bytes.toString('ascii', 12, 16));
}

export function assertScanEvidence(data: { captureMethod: 'CAMERA' | 'MANUAL'; evidenceImageUrl?: string }) {
  if (data.captureMethod === 'MANUAL' && !isInlineCapturedImage(data.evidenceImageUrl)) {
    throw new Error('MANUAL_PHOTO_REQUIRED');
  }
}
