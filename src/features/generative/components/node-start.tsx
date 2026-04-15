import { useCallback, useRef, useState, memo } from 'react';
import { ImagePlus, X } from 'lucide-react';
import { toast } from 'sonner';
import { useGenerativeStore } from '../stores/generative-store';
import { ImageGenDialog } from './image-gen-dialog';
import type { ImageSource } from '../types';

/**
 * Node A: Start Image drop-zone.
 * Users can drag an image, paste from clipboard,
 * or generate one with AI (Nanobanana 2).
 */
export const NodeStart = memo(function NodeStart() {
  const startImage = useGenerativeStore((s) => s.startImage);
  const setStartImage = useGenerativeStore((s) => s.setStartImage);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleFile = useCallback(
    async (file: File) => {
      if (!file.type.startsWith('image/')) return;
      try {
        // Read file data into memory immediately to prevent stale file handle references.
        // Raw File objects can become unreadable when the browser tab goes inactive.
        const buffer = await file.arrayBuffer();
        const blob = new Blob([buffer], { type: file.type });
        const objectUrl = URL.createObjectURL(blob);
        // Revoke the old URL only after the new one is ready to avoid a broken-image flash.
        if (startImage?.type === 'file') {
          URL.revokeObjectURL(startImage.objectUrl);
        }
        setStartImage({ type: 'file', blob, objectUrl });
      } catch {
        toast.error('Could not read the selected image. Please try again.');
      }
    },
    [setStartImage, startImage],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  const handleClear = useCallback(() => {
    if (startImage?.type === 'file') {
      URL.revokeObjectURL(startImage.objectUrl);
    }
    setStartImage(null);
  }, [setStartImage, startImage]);

  const handleImageGenerated = useCallback(
    (source: ImageSource) => {
      if (startImage?.type === 'file') {
        URL.revokeObjectURL(startImage.objectUrl);
      }
      setStartImage(source);
    },
    [setStartImage, startImage],
  );

  const previewUrl =
    startImage?.type === 'file'
      ? startImage.objectUrl
      : startImage?.type === 'generated'
        ? startImage.url
        : null;

  return (
    <div className="flex flex-col items-center gap-2">
      <span className="text-xs font-medium text-muted-foreground">Start Image</span>
      <div
        className={`relative flex h-28 w-28 items-center justify-center rounded-lg border-2 border-dashed transition-colors sm:h-40 sm:w-40 ${
          dragOver
            ? 'border-primary bg-primary/10'
            : 'border-border bg-muted/30 hover:border-primary/50'
        }`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => !startImage && inputRef.current?.click()}
      >
        {previewUrl ? (
          <>
            <img
              src={previewUrl}
              alt="Start"
              className="h-full w-full rounded-lg object-cover"
              onError={() => {
                handleClear();
                toast.error('Image preview expired. Please re-add the image.');
              }}
            />
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleClear();
              }}
              className="absolute -right-2 -top-2 rounded-full bg-destructive p-1 text-destructive-foreground shadow-sm"
            >
              <X className="h-3 w-3" />
            </button>
            {startImage?.type === 'generated' && (
              <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 py-0.5 text-[10px] text-white">
                AI
              </span>
            )}
          </>
        ) : (
          <div className="flex flex-col items-center gap-1 text-muted-foreground">
            <ImagePlus className="h-8 w-8" />
            <span className="text-xs">Drop or click</span>
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
        />
      </div>
      <ImageGenDialog node="start" onImageGenerated={handleImageGenerated} />
    </div>
  );
});
