import { createFileRoute } from '@tanstack/react-router'
import { AgentAuthorizationPage } from '@/components/agent-authorization-page'

export const Route = createFileRoute('/authorize')({
  validateSearch: (search: Record<string, unknown>) => ({
    user_code: typeof search.user_code === 'string' ? search.user_code : '',
  }),
  component: AuthorizeRoute,
})

function AuthorizeRoute() {
  const { user_code } = Route.useSearch()
  return <AgentAuthorizationPage key={user_code} initialCode={user_code} />
}
