'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, RotateCcw, X } from 'lucide-react';
import styles from './unit-photo-camera.module.css';

type Phase = 'idle' | 'opening' | 'ready' | 'processing';

type Props = {
  disabled: boolean;
  onCapture: (file: File) => Promise<void>;
  onCameraError?: (message: string) => void;
};

function cameraMessage(reason: unknown) {
  if (reason instanceof DOMException) {
    if (reason.name === 'NotAllowedError' || reason.name === 'SecurityError') {
      return 'Allow camera access in your browser settings, then try again. A fresh barcode photo is required for manual entry.';
    }
    if (reason.name === 'NotFoundError') return 'No camera was found. Use a device with a camera to take the required barcode photo.';
    if (reason.name === 'NotReadableError') return 'The camera is unavailable or being used by another app. Close the other camera, then try again.';
  }
  return reason instanceof Error ? reason.message : 'Unable to open the camera. Try again or use Refresh scan page.';
}

export default function UnitPhotoCamera({ disabled, onCapture, onCameraError }: Props) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState('');
  const [captured, setCaptured] = useState(false);
  const phaseRef = useRef<Phase>('idle');
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sessionRef = useRef(0);
  const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stallTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const errorCallbackRef = useRef(onCameraError);
  errorCallbackRef.current = onCameraError;

  const changePhase = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const releaseHardware = useCallback(() => {
    if (openTimerRef.current) clearTimeout(openTimerRef.current);
    if (stallTimerRef.current) clearInterval(stallTimerRef.current);
    openTimerRef.current = null;
    stallTimerRef.current = null;
    const stream = streamRef.current;
    streamRef.current = null;
    for (const track of stream?.getTracks() ?? []) {
      track.onended = null;
      track.stop();
    }
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
    }
  }, []);

  const stopCamera = useCallback(() => {
    // Invalidates unresolved permission requests as well as the current stream.
    sessionRef.current += 1;
    releaseHardware();
  }, [releaseHardware]);

  const fail = useCallback((session: number, message: string) => {
    if (session !== sessionRef.current) return;
    stopCamera();
    changePhase('idle');
    setError(message);
    errorCallbackRef.current?.(message);
  }, [changePhase, stopCamera]);

  const cameraReady = useCallback(() => {
    const video = videoRef.current;
    if (phaseRef.current !== 'opening' || !streamRef.current || !video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return;
    if (openTimerRef.current) clearTimeout(openTimerRef.current);
    openTimerRef.current = null;
    changePhase('ready');
    const session = sessionRef.current;
    let lastFrameTime = video.currentTime;
    let lastProgress = Date.now();
    stallTimerRef.current = setInterval(() => {
      if (session !== sessionRef.current || phaseRef.current !== 'ready') return;
      if (video.currentTime !== lastFrameTime) {
        lastFrameTime = video.currentTime;
        lastProgress = Date.now();
      } else if (Date.now() - lastProgress >= 9_000) {
        fail(session, 'The camera stopped updating. Try the camera again, or use Refresh scan page if it is still stuck.');
      }
    }, 3_000);
  }, [changePhase, fail]);

  useEffect(() => () => stopCamera(), [stopCamera]);

  useEffect(() => {
    if (disabled && (phaseRef.current === 'opening' || phaseRef.current === 'ready')) {
      stopCamera();
      changePhase('idle');
    }
  }, [disabled, stopCamera, changePhase]);

  useEffect(() => {
    function suspendCamera() {
      if (document.visibilityState === 'hidden' && (phaseRef.current === 'opening' || phaseRef.current === 'ready')) {
        stopCamera();
        changePhase('idle');
        setError('Camera paused while the app was in the background. Open it again to take the photo.');
      }
    }
    document.addEventListener('visibilitychange', suspendCamera);
    return () => document.removeEventListener('visibilitychange', suspendCamera);
  }, [changePhase, stopCamera]);

  async function openCamera() {
    if (disabled || phaseRef.current === 'processing' || phaseRef.current === 'opening') return;
    stopCamera();
    const session = sessionRef.current;
    setError('');
    changePhase('opening');
    if (!navigator.mediaDevices?.getUserMedia) {
      fail(session, 'This browser cannot open the camera. Open BlueRock IMS in a supported browser over HTTPS.');
      return;
    }
    openTimerRef.current = setTimeout(() => {
      fail(session, 'The camera took too long to open. Check camera permission, then try again or use Refresh scan page.');
    }, 15_000);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
      // getUserMedia cannot be aborted; stop late results after cancel, timeout, or unmount.
      if (session !== sessionRef.current) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) throw new Error('Camera preview is unavailable. Try opening it again.');
      stream.getVideoTracks().forEach(track => {
        track.onended = () => fail(session, 'The camera disconnected. Open it again to take the required barcode photo.');
      });
      video.srcObject = stream;
      await video.play();
      if (session === sessionRef.current) cameraReady();
    } catch (reason) {
      fail(session, cameraMessage(reason));
    }
  }

  async function capturePhoto() {
    if (disabled || phaseRef.current !== 'ready') return;
    const session = sessionRef.current;
    const video = videoRef.current;
    if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight || !streamRef.current?.active) {
      fail(session, 'The camera has no live image. Open it again before taking the photo.');
      return;
    }
    changePhase('processing');
    setError('');
    try {
      const canvas = document.createElement('canvas');
      const scale = Math.min(1, 1920 / Math.max(video.videoWidth, video.videoHeight));
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Unable to capture a photo in this browser.');
      const capturedAt = Date.now();
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      releaseHardware();
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(value => value ? resolve(value) : reject(new Error('Unable to create the photo. Please take it again.')), 'image/jpeg', 0.9);
      });
      if (session !== sessionRef.current) return;
      await onCapture(new File([blob], `barcode-photo-${capturedAt}.jpg`, { type: 'image/jpeg', lastModified: capturedAt }));
      if (session !== sessionRef.current) return;
      setCaptured(true);
      changePhase('idle');
    } catch (reason) {
      fail(session, cameraMessage(reason));
    }
  }

  function cancelCamera() {
    stopCamera();
    changePhase('idle');
    setError('');
  }

  const cameraVisible = phase === 'opening' || phase === 'ready';
  return <section className={styles.container} aria-label="Required barcode photo">
    <p className={styles.guidance}>Manual entry requires a fresh camera photo. Keep the material and its barcode clearly visible; capture time and GPS coordinates will be stamped on the photo.</p>
    <div className={styles.viewport} hidden={!cameraVisible}>
      <video ref={videoRef} muted playsInline autoPlay onLoadedData={cameraReady} onCanPlay={cameraReady} aria-label="Live barcode photo camera" />
      {phase === 'opening' && <div className={styles.opening} role="status">Opening camera…</div>}
    </div>
    <div className={styles.actions}>
      {cameraVisible ? <>
        <button type="button" className={styles.capture} disabled={disabled || phase !== 'ready'} onClick={() => void capturePhoto()}><Camera size={18} aria-hidden="true" /> Capture barcode photo</button>
        <button type="button" className={styles.secondary} onClick={cancelCamera}><X size={18} aria-hidden="true" /> Cancel camera</button>
      </> : <button type="button" className={styles.capture} disabled={disabled || phase === 'processing'} onClick={() => void openCamera()}>
        {captured ? <RotateCcw size={18} aria-hidden="true" /> : <Camera size={18} aria-hidden="true" />}
        {phase === 'processing' ? 'Preparing stamped photo…' : captured ? 'Retake required barcode photo' : 'Take required barcode photo'}
      </button>}
    </div>
    {phase === 'processing' && <p className={styles.status} role="status">Saving the photo with its capture time and location…</p>}
    {error && <p className={styles.error} role="alert">{error}</p>}
  </section>;
}
