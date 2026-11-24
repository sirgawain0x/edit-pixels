import { useEffect } from 'react'
import { createLazyFileRoute } from '@tanstack/react-router'
import { Editor } from '@/features/editor/components/editor'
import { blobUrlManager } from '@/infrastructure/browser/blob-url-manager'

export const Route = createLazyFileRoute('/editor/$projectId')({
  component: EditorPage,
})

function EditorPage() {
  const { projectId } = Route.useParams()
  const { project, migration } = Route.useLoaderData()

  // Hold media blob URLs for as long as this editor is mounted. The `/projects` route revokes them
  // in `beforeLoad`, which also fires on preload — so without this a hover over a Projects link
  // kills every URL the open editor is rendering from (`ERR_FILE_NOT_FOUND`, silent audio).
  useEffect(() => blobUrlManager.retainEditor(), [])

  return <Editor projectId={projectId} project={project} migration={migration} />
}
