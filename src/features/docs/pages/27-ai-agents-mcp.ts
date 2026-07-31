import type { DocPageContent } from '../docs-content'

const page = {
  order: 27,
  slug: 'ai-agents-mcp',
  title: 'AI Agents and MCP',
  description:
    'Drive Creative Pixels from AI agents via the MCP server, the shared agent prompt, OpenClaw vs Hermes packaging, and Pinata Digital Twin templates.',
  category: 'Reference',
  related: ['local-ai', 'workspaces', 'export', 'troubleshooting'],
  sections: [
    {
      title: 'Ways to use AI with Creative Pixels',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Creative Pixels supports three related AI surfaces. Pick the one that matches how you work:',
        },
        {
          kind: 'list',
          items: [
            '**Local AI** in the editor — text to speech, music, and transcription that run in your browser. See [Local AI Tools](local-ai).',
            '**Pixels MCP** — a local stdio server so Hermes, Claude Desktop, or another MCP client can create, edit, and render projects programmatically.',
            '**Pinata Creative AI Digital Twin** — hosted digital-twin agents (alignment, avatars, studio/broadcast) that can also drive Pixels MCP **when connected** to your local server.',
          ],
        },
      ],
    },
    {
      title: 'Pixels MCP server',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Pixels ships a headless lifecycle API and a Model Context Protocol (MCP) stdio server. Agents talk to the server over stdio; under the hood it launches the headless HTTP service for your workspace.',
        },
        {
          kind: 'steps',
          items: [
            'From the Creative Pixels repo, run `npm run headless:mcp -- --workspace /path/to/pixels-workspace`.',
            'Or build once with `npm run build`, then run the same `headless:mcp` command.',
            'Point your MCP client at that command so tools are available to the agent.',
          ],
        },
        {
          kind: 'list',
          items: [
            '`PIXELS_WORKSPACE` — default workspace directory when `--workspace` is omitted.',
            '`PIXELS_MCP_LOG` — optional log file path (logs stay off stderr by default so MCP traffic stays clean).',
          ],
        },
        {
          kind: 'table',
          headers: ['Tool', 'Purpose'],
          rows: [
            ['`pixels_capabilities`', 'Supported edit ops, GPU effects, codecs, and schemas'],
            ['`pixels_list_projects` / `pixels_get_project`', 'List or inspect projects'],
            [
              '`pixels_create_project` / `pixels_update_project`',
              'Create or update project metadata',
            ],
            [
              '`pixels_edit_project`',
              'Timeline ops (`addText`, `addClip`, `addTrack`, `moveItem`, `split`, `trimStart`, `trimEnd`, `addEffect`, `setTransform`, `removeItems`, and more)',
            ],
            [
              '`pixels_list_media` / `pixels_get_media` / `pixels_import_media`',
              'Browse and import media',
            ],
            ['`pixels_render_project`', 'Export to MP4, WebM, or audio'],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'The MCP server name is `creative_pixels`. Some clients expose tools as `pixels_*`; others prefix them as `mcp_creative_pixels_pixels_*`.',
        },
      ],
    },
    {
      title: 'Shared agent skill prompt',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Use one runtime-agnostic prompt for video MCP — the same tool rules for OpenClaw and Hermes. In this repo that prompt lives at `docs/agent-prompt.md`. Paste or attach it (or the template’s `creative-pixels-mcp` skill) into your agent client.',
        },
        {
          kind: 'steps',
          items: [
            'Import media with an absolute path if it is not already in the workspace.',
            'Call `pixels_capabilities` when you need supported ops, effects, codecs, or schemas.',
            'Create a project, or `pixels_get_project` first for an existing one.',
            'Edit with `pixels_edit_project` — every op needs a unique `callerId`; reference earlier results with `{ "$ref": "callerId#/detail/..." }`.',
            'Render with `pixels_render_project` and report the output path, size, duration, and warnings.',
          ],
        },
        {
          kind: 'note',
          tone: 'warning',
          text: 'Keep the workspace on a local, non–cloud-synced folder. GPU effects need a real WebGPU adapter. Do not render to cloud-synced or network paths.',
        },
      ],
    },
    {
      title: 'OpenClaw vs Hermes runtimes',
      blocks: [
        {
          kind: 'paragraph',
          text: 'OpenClaw and Hermes share the same MCP tools and workflow. They differ in packaging, manifests, and how you wire the stdio server — not in skill semantics for video editing.',
        },
        {
          kind: 'table',
          headers: ['', 'OpenClaw (Pinata)', 'Hermes'],
          rows: [
            ['Runtime', 'Pinata-hosted OpenClaw workspace', 'Hermes Agent skill'],
            [
              'Primary files',
              '`manifest.json`, `workspace/{SOUL,AGENTS,BOOTSTRAP,TOOLS}.md`, `.openclaw/openclaw.json`',
              '`SKILL.md`, `manifest.json` with `template.platform: hermes`',
            ],
            [
              'MCP skill location',
              '`workspace/skills/creative-pixels-mcp.md`',
              '`references/creative-pixels-mcp.md` (linked from `SKILL.md`)',
            ],
            [
              'How you connect Pixels',
              'Deploy on Pinata and point the agent MCP config at local `headless:mcp`',
              'Load the skill, then add a stdio MCP client entry for `headless:mcp`',
            ],
          ],
        },
        {
          kind: 'paragraph',
          text: 'Example stdio MCP client config for Hermes or Claude Desktop (adjust the workspace path):',
        },
        {
          kind: 'list',
          items: [
            'Server key: `creative_pixels`',
            'Command: `npm`',
            'Args: `run`, `headless:mcp`, `--`, `--workspace`, `/path/to/pixels-workspace`',
            'Run from the Creative Pixels repo root (or use an absolute path to `node` + `headless/mcp-server.mjs`)',
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Template sources live in the Creative agent-templates repo under `openclaw/` and `hermes/`. Keep one shared MCP prompt body; only the packaging files differ.',
        },
      ],
    },
    {
      title: 'Pinata Creative AI Digital Twin',
      blocks: [
        {
          kind: 'paragraph',
          text: 'If you prefer a hosted agent, deploy a Creative AI Digital Twin template from the Pinata marketplace. These are digital-twin agents for creative work; they can also create, edit, and render video via Pixels MCP **when connected** to your local server.',
        },
        {
          kind: 'list',
          items: [
            '[Creative AI Digital Twin](https://agents.pinata.cloud/landing/marketplace/tmernpdi) — full template: alignment games, 3D avatars with C2PA, ERC-8004 on Base, Creative TV / Livepeer broadcast tools, tokens and markets, plus Pixels MCP when connected.',
            '[Creative AI Digital Twin Lite](https://agents.pinata.cloud/landing/marketplace/tbini922) — lighter template focused on YouTube/Twitch creators, with the same Pixels MCP video workflows when connected.',
          ],
        },
        {
          kind: 'steps',
          items: [
            'Deploy the template on Pinata and open the agent chat.',
            'Start `npm run headless:mcp -- --workspace /path/to/pixels-workspace` on your machine.',
            'Point the agent’s MCP config at that local stdio server.',
            'Ask the agent to import, edit, and render — digital-twin features work without MCP; video edit/render needs the connection.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Live Pinata listings typically run the OpenClaw engine. Hermes variants use `platform: hermes` in their manifest for discovery — same agent concept, different packaging.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
