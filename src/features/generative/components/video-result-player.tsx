import { memo } from 'react';
import { toast } from 'sonner';

interface VideoResultPlayerProps {
  url: string;
}

export const VideoResultPlayer = memo(function VideoResultPlayer({
  url,
}: VideoResultPlayerProps) {
  return (
    <video
      src={url}
      className="h-full w-full object-contain"
      controls
      autoPlay
      loop
      playsInline
      onError={() => toast.error('Failed to load the generated video.')}
    />
  );
});
