'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, Image as ImageIcon, X } from 'lucide-react';

import styles from './scan-evidence.module.css';

type EvidencePhoto = {
  id: string;
  barcode: string;
  name: string;
  imageUrl?: string;
  capturedAt: string | null;
  scannedAt: string;
  scannerName: string | null;
  latitude: number | null;
  longitude: number | null;
  locationAccuracy: number | null;
  captureMethod: 'CAMERA' | 'MANUAL' | null;
  locationName?: string | null;
};

type Props = {
  scanId: string | null | undefined;
  photoCount?: number;
  api: <T>(url: string, options?: RequestInit) => Promise<T>;
};

function displayDate(value: string | null) {
  return value ? new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' }) : 'Not recorded';
}

export default function ScanEvidence({ scanId, photoCount = 1, api }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [photos, setPhotos] = useState<EvidencePhoto[]>([]);
  const [index, setIndex] = useState(0);
  const [imageFailed, setImageFailed] = useState(false);
  const [imageUrl, setImageUrl] = useState('');
  const [imageLoading, setImageLoading] = useState(false);
  const apiRef = useRef(api);
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const photo = photos[index];
  useEffect(() => { apiRef.current = api; }, [api]);
  useEffect(() => {
    setImageUrl('');
    setImageFailed(false);
    if (!open || !photo?.id || !scanId) return;
    const controller = new AbortController();
    setImageLoading(true);
    void apiRef.current<{photos: EvidencePhoto[]}>(`/api/scans/${encodeURIComponent(scanId)}/evidence?photo=${encodeURIComponent(photo.id)}`, {cache:'no-store',signal:controller.signal})
      .then(result => { if (!controller.signal.aborted) { setImageUrl(result.photos[0]?.imageUrl || ''); setImageFailed(!result.photos[0]?.imageUrl); } })
      .catch(() => { if (!controller.signal.aborted) setImageFailed(true); })
      .finally(() => { if (!controller.signal.aborted) setImageLoading(false); });
    return () => controller.abort();
  }, [open,photo?.id,scanId]);

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
      if (event.key !== 'Tab') return;
      const controls = panelRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), [href], [tabindex="0"]');
      if (!controls?.length) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [open]);

  async function showPhotos() {
    if (!scanId || photoCount < 1) return;
    setOpen(true);
    setLoading(true);
    setError('');
    setPhotos([]);
    setIndex(0);
    setImageFailed(false);
    try {
      const result = await api<{ photos: EvidencePhoto[] }>(`/api/scans/${encodeURIComponent(scanId)}/evidence`, { cache: 'no-store' });
      setPhotos(result.photos);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load scan photos');
    } finally {
      setLoading(false);
    }
  }

  function changePhoto(next: number) {
    setIndex(next);
    setImageFailed(false);
  }

  return <>
    <button type="button" className={styles.trigger} onClick={showPhotos} disabled={!scanId || photoCount < 1}>
      <ImageIcon size={15} aria-hidden="true" />
      {!scanId || photoCount < 1 ? 'No photo' : photoCount > 1 ? `View photos (${photoCount})` : 'View photo'}
    </button>
    {open && createPortal(
      <div className="modalBackdrop imagePreviewBackdrop" onMouseDown={event => { if (event.currentTarget === event.target) setOpen(false); }}>
        <section ref={panelRef} className={`imagePreview ${styles.preview}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
          <button ref={closeRef} type="button" className="imagePreviewClose" onClick={() => setOpen(false)} aria-label="Close scan photos"><X /></button>
          <header className={styles.header}>
            <h2 id={titleId}>Scan photos</h2>
            <p>{photo ? `${photo.name} · ${photo.barcode}` : 'Attached evidence from the scan'}</p>
          </header>
          {loading && <p className={styles.message} role="status">Loading photos…</p>}
          {error && <p className={styles.message} role="alert">{error}</p>}
          {!loading && !error && !photo && <p className={styles.message}>No photo was attached to this scan.</p>}
          {photo && <>
            {imageLoading ? <p className={styles.message} role="status">Loading photo…</p> : imageFailed ? <p className={styles.message} role="alert">This photo could not be displayed. Close and reopen to retry.</p> : imageUrl ? <img className={styles.photo} src={imageUrl} alt={`Scan evidence for ${photo.name}, barcode ${photo.barcode}`} referrerPolicy="no-referrer" onError={() => setImageFailed(true)} /> : null}
            <footer className={styles.details}>
              {photos.length > 1 && <nav className={styles.navigation} aria-label="Scan photos">
                <button type="button" onClick={() => changePhoto(index - 1)} disabled={index === 0} aria-label="Previous photo"><ChevronLeft size={18} /></button>
                <span>Photo {index + 1} of {photos.length}</span>
                <button type="button" onClick={() => changePhoto(index + 1)} disabled={index === photos.length - 1} aria-label="Next photo"><ChevronRight size={18} /></button>
              </nav>}
              <dl>
                <div><dt>Captured</dt><dd>{displayDate(photo.capturedAt)}</dd></div>
                <div><dt>Submitted</dt><dd>{displayDate(photo.scannedAt)}</dd></div>
                <div><dt>Scanned by</dt><dd>{photo.scannerName || 'Not recorded'}</dd></div>
                <div><dt>Location</dt><dd>{photo.locationName || 'Not recorded'}</dd></div>
                <div><dt>GPS coordinates</dt><dd>{photo.latitude != null && photo.longitude != null ? `${Number(photo.latitude).toFixed(6)}, ${Number(photo.longitude).toFixed(6)}${photo.locationAccuracy != null ? ` (±${Math.round(Number(photo.locationAccuracy))} m)` : ''}` : 'Not recorded'}</dd></div>
                <div><dt>Barcode capture</dt><dd>{photo.captureMethod === 'MANUAL' ? 'Manual entry' : photo.captureMethod === 'CAMERA' ? 'Camera scan' : 'Not recorded'}</dd></div>
              </dl>
            </footer>
          </>}
        </section>
      </div>, document.body,
    )}
  </>;
}
