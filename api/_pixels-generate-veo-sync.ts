/**
 * Sync Creative Pixels Veo poll results back to the generate job record.
 */
// fallow-ignore-file complexity

import type { GenerativeTaskDetail } from './_generative-task-response.js'
import { failPixelsGenerateJob } from './_pixels-generate-payment.js'
import {
  getPixelsGenerateJobIdByVeoTask,
  updatePixelsGenerateJob,
} from './_pixels-generate-jobs.js'

export async function syncPixelsVeoJobFromPoll(
  veoTaskId: string,
  detail: GenerativeTaskDetail,
): Promise<void> {
  const jobId = await getPixelsGenerateJobIdByVeoTask(veoTaskId)
  if (!jobId) return

  if (detail.status === 'completed' && detail.output?.video_url) {
    await updatePixelsGenerateJob(jobId, {
      status: 'completed',
      progress: 100,
      output: { video_url: detail.output.video_url },
    })
    return
  }

  if (detail.status === 'failed') {
    await failPixelsGenerateJob(jobId, {
      code: detail.error?.code ?? 'generation_failed',
      message: detail.error?.message ?? 'Generation failed',
      type: detail.error?.type ?? 'vertex',
    })
  }
}
