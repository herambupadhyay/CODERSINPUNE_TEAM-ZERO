import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ArrowRight, MessageSquare, Sparkles, Upload, UserPlus } from 'lucide-react'
import { toast } from 'sonner'
import { ApiError, projectsApi } from '@/lib/api'
import { useCurrentProject } from '@/providers/AppProviders'
import {
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  PageHeader,
  RoleChip,
  Spinner,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TRow,
  Textarea,
} from '@/components/app/ui'

const createSchema = z.object({
  name: z.string().trim().min(1, 'Give the project a name.'),
  description: z.string().trim().optional(),
  tags: z.string().trim().optional(),
})

type CreateValues = z.infer<typeof createSchema>

type Stat = { label: string; value: number; to: string }

const QUICK_ACTIONS = [
  { label: 'Upload document', description: 'Add source files to the project', to: '/app/documents', icon: Upload },
  { label: 'Review pending', description: 'Verify extracted knowledge items', to: '/app/knowledge', icon: UserPlus },
  { label: 'Start handover', description: 'Generate a departure packet', to: '/app/handover', icon: Sparkles },
  { label: 'Ask assistant', description: 'Question the project knowledge', to: '/app/assistant', icon: MessageSquare },
] as const

function CreateProjectForm({ workspaceId }: { workspaceId: string }) {
  const qc = useQueryClient()
  const { setProject } = useCurrentProject()
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<CreateValues>({
    resolver: zodResolver(createSchema),
    defaultValues: { name: '', description: '', tags: '' },
  })

  const onSubmit = async (values: CreateValues) => {
    try {
      const tags = (values.tags ?? '')
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean)
      const created = await projectsApi.create(workspaceId, {
        name: values.name,
        description: values.description?.trim() || null,
        tags,
      })
      await qc.invalidateQueries({ queryKey: ['projects'] })
      setProject(created.id)
      toast.success('Project created.')
    } catch (err) {
      const message =
        err instanceof ApiError ? err.detail || err.error : 'Could not create the project.'
      setError('root', { message })
    }
  }

  return (
    <div className="mt-8 max-w-xl">
      <Card className="p-6">
        <p className="label-mono text-forest">New project</p>
        <h2 className="mt-2 font-display text-2xl tracking-tight text-ink">
          Create your first project
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Projects hold documents, extracted knowledge and handovers. Give this one a name your
          team will recognise.
        </p>

        <form onSubmit={handleSubmit(onSubmit)} noValidate className="mt-6 flex flex-col gap-4">
          <Field label="Project name" htmlFor="project-name" error={errors.name?.message}>
            <Input
              id="project-name"
              placeholder="Payments Platform"
              invalid={!!errors.name}
              {...register('name')}
            />
          </Field>
          <Field
            label="Description"
            htmlFor="project-description"
            error={errors.description?.message}
            hint="Optional — what this project covers."
          >
            <Textarea
              id="project-description"
              placeholder="Checkout, refunds and the settlement pipeline."
              invalid={!!errors.description}
              {...register('description')}
            />
          </Field>
          <Field
            label="Tags"
            htmlFor="project-tags"
            error={errors.tags?.message}
            hint="Optional — comma separated, e.g. payments, onboarding."
          >
            <Input id="project-tags" placeholder="payments, onboarding" invalid={!!errors.tags} {...register('tags')} />
          </Field>

          {errors.root?.message ? (
            <div role="alert" className="rounded-[3px] border border-ember/40 bg-ember/8 px-3.5 py-2.5 text-sm text-ember">
              {errors.root.message}
            </div>
          ) : null}

          <Button type="submit" size="lg" loading={isSubmitting}>
            Create project
          </Button>
        </form>
      </Card>
    </div>
  )
}

function MembersCard({ projectId }: { projectId: string }) {
  const membersQuery = useQuery({
    queryKey: ['projectMembers', projectId],
    queryFn: () => projectsApi.members(projectId),
  })

  return (
    <Card className="overflow-hidden">
      <div className="flex items-baseline justify-between gap-3 border-b border-line px-5 py-4">
        <h2 className="font-display text-lg tracking-tight text-ink">Project members</h2>
        {membersQuery.data ? (
          <span className="label-mono text-muted">{membersQuery.data.length} active</span>
        ) : null}
      </div>

      {membersQuery.isPending ? (
        <div className="flex items-center justify-center gap-3 px-5 py-10 text-sm text-muted">
          <Spinner size={15} /> Loading members…
        </div>
      ) : membersQuery.isError || !membersQuery.data?.length ? (
        <div className="px-5 py-8">
          <EmptyState
            title="Members will appear here."
            description="People added to this project show up with their role and responsibility."
            className="border-0 bg-transparent py-8"
          />
        </div>
      ) : (
        <Table>
          <THead>
            <TRow className="border-b border-line">
              <TH>Name</TH>
              <TH>Role</TH>
              <TH>Responsibility</TH>
            </TRow>
          </THead>
          <TBody>
            {membersQuery.data.map((member) => (
              <TRow key={member.user_id}>
                <TD>
                  <p className="font-medium text-ink">{member.name || '—'}</p>
                  <p className="text-xs text-muted">{member.email}</p>
                </TD>
                <TD>
                  <RoleChip role={member.role} />
                </TD>
                <TD className="text-muted">{member.responsibility || '—'}</TD>
              </TRow>
            ))}
          </TBody>
        </Table>
      )}
    </Card>
  )
}

function QuickActionsCard() {
  return (
    <Card className="p-5">
      <h2 className="font-display text-lg tracking-tight text-ink">Quick actions</h2>
      <div className="mt-4 flex flex-col gap-2">
        {QUICK_ACTIONS.map((action) => {
          const Icon = action.icon
          return (
            <Link
              key={action.to + action.label}
              to={action.to}
              className="group flex items-center justify-between gap-3 rounded-[3px] border border-line bg-paper px-4 py-3 transition-colors duration-150 hover:border-ink/25 hover:bg-cream"
            >
              <span className="flex min-w-0 items-center gap-3">
                <Icon size={15} className="shrink-0 text-forest" aria-hidden />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-ink">{action.label}</span>
                  <span className="block truncate text-xs text-muted">{action.description}</span>
                </span>
              </span>
              <ArrowRight
                size={14}
                className="shrink-0 text-muted transition-colors duration-150 group-hover:text-forest"
                aria-hidden
              />
            </Link>
          )
        })}
      </div>
    </Card>
  )
}

export function OverviewPage() {
  const { workspace, project, counts, projectsQuery, projectQuery } =
    useCurrentProject()

  if (!workspace) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader overline="Workspace" title="Overview" />
        <EmptyState
          title="No workspace yet."
          description="Your account has no active workspace. Sign out and create a new account to get started."
        />
      </div>
    )
  }

  if (projectsQuery.isPending) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader overline={workspace.name} title="Overview" />
        <div className="flex items-center gap-3 text-sm text-muted">
          <Spinner size={15} /> Loading projects…
        </div>
      </div>
    )
  }

  if (projectsQuery.isError) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader overline={workspace.name} title="Overview" />
        <EmptyState
          title="Projects could not be loaded."
          description="The project list is unavailable right now. Try again in a moment."
          action={
            <Button variant="outline" onClick={() => void projectsQuery.refetch()}>
              Try again
            </Button>
          }
        />
      </div>
    )
  }

  if (!project) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          overline={workspace.name}
          title="Overview"
          description="A workspace with no projects yet — create the first one to start collecting documents and knowledge."
        />
        <CreateProjectForm workspaceId={workspace.id} />
      </div>
    )
  }

  const c = counts ?? project.counts
  const stats: Stat[] = [
    { label: 'Documents', value: c.documents, to: '/app/documents' },
    { label: 'Chunks', value: c.chunks, to: '/app/documents' },
    { label: 'Knowledge items', value: c.knowledge, to: '/app/knowledge' },
    { label: 'Pending review', value: c.pending_review, to: '/app/knowledge' },
    { label: 'Handovers', value: c.handovers, to: '/app/handover' },
    { label: 'Open tasks', value: c.open_tasks, to: '/app/knowledge' },
    { label: 'Gaps', value: c.gaps, to: '/app/knowledge' },
    { label: 'Members', value: c.members, to: '/app/authority' },
  ]

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        overline={workspace.name}
        title={project.name}
        description={project.description || undefined}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {project.archived ? <span className="label-mono border border-line bg-cream px-2 py-[3px] text-muted">archived</span> : null}
            <RoleChip role={project.my_role} />
            {projectQuery.isFetching ? <Spinner size={13} className="text-muted" /> : null}
          </div>
        }
      />

      <section aria-label="Project counts">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {stats.map((stat) => (
            <Link key={stat.label} to={stat.to} className="pp-stat">
              <span className="pp-stat-value">{stat.value}</span>
              <span className="label-mono text-muted">{stat.label}</span>
            </Link>
          ))}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[1.7fr_1fr]">
        <MembersCard projectId={project.id} />
        <QuickActionsCard />
      </div>
    </div>
  )
}
