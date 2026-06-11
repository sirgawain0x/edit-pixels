import { memo, useCallback } from 'react';
import { NodeStart } from './node-start';
import { NodeBridge } from './node-bridge';
import { NodeEnd } from './node-end';
import { RenderControls } from './render-controls';
import { useGenerativeReady } from '../hooks/use-generative-auth';
import { useGenerativeStore } from '../stores/generative-store';
import { IDLE_TASK } from '../types';

/**
 * Flow Stage (Zone 2).
 * Three-node horizontal layout: Start Image -> Video Generation -> End Image.
 * Uses Seedance 2.0 (image-to-video) and Nanobanana 2 (image generation).
 */
export const FlowStage = memo(function FlowStage() {
  const setVideoTask = useGenerativeStore((s) => s.setVideoTask);
  const setResultVideoUrl = useGenerativeStore((s) => s.setResultVideoUrl);
  const ready = useGenerativeReady();

  const handleCancelVideo = useCallback(() => {
    setVideoTask({ ...IDLE_TASK });
    setResultVideoUrl(null);
  }, [setVideoTask, setResultVideoUrl]);

  return (
    <div className="flex h-full w-full flex-col items-center justify-start gap-4 overflow-y-auto bg-background p-3 sm:justify-center sm:gap-6 sm:p-4">
      {!ready && (
        <p className="text-xs text-muted-foreground">
          Connect your wallet to use Flow generation.
        </p>
      )}

      <div className="flex flex-col items-center gap-3 sm:flex-row sm:gap-4">
        <NodeStart />

        <svg width="40" height="2" className="hidden text-border sm:block" aria-hidden="true">
          <line x1="0" y1="1" x2="40" y2="1" stroke="currentColor" strokeWidth="2" strokeDasharray="4 4" />
        </svg>
        <svg width="2" height="24" className="block text-border sm:hidden" aria-hidden="true">
          <line x1="1" y1="0" x2="1" y2="24" stroke="currentColor" strokeWidth="2" strokeDasharray="4 4" />
        </svg>

        <NodeBridge onCancelVideo={handleCancelVideo} />

        <svg width="40" height="2" className="hidden text-border sm:block" aria-hidden="true">
          <line x1="0" y1="1" x2="40" y2="1" stroke="currentColor" strokeWidth="2" strokeDasharray="4 4" />
        </svg>
        <svg width="2" height="24" className="block text-border sm:hidden" aria-hidden="true">
          <line x1="1" y1="0" x2="1" y2="24" stroke="currentColor" strokeWidth="2" strokeDasharray="4 4" />
        </svg>

        <NodeEnd />
      </div>

      {ready && <RenderControls />}
    </div>
  );
});
