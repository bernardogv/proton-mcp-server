# Proton Mail MCP Server

An MCP (Model Context Protocol) server that connects to ProtonMail via Proton Bridge, giving AI agents full email management capabilities over IMAP and SMTP.

## Prerequisites

- **[Proton Bridge](https://proton.me/mail/bridge)** — must be installed, logged in, and running
- **Node.js** >= 18
- A Proton Mail account (any paid plan — Bridge requires it)

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` with your Bridge credentials:

```env
PROTON_BRIDGE_IMAP_HOST=127.0.0.1
PROTON_BRIDGE_IMAP_PORT=1143
PROTON_BRIDGE_SMTP_HOST=127.0.0.1
PROTON_BRIDGE_SMTP_PORT=1025
PROTON_BRIDGE_USERNAME=you@proton.me
PROTON_BRIDGE_PASSWORD=your-bridge-generated-password
```

> **Finding your Bridge password:** Open Proton Bridge > click your account > "Mailbox details" > copy the password. This is NOT your Proton account password.

### 3. Build

```bash
npm run build
```

### 4. Add to your MCP client

Add to your Claude Desktop `claude_desktop_config.json` or Claude Code settings:

```json
{
  "mcpServers": {
    "protonmail": {
      "command": "node",
      "args": ["/absolute/path/to/proton-mcp-server/dist/index.js"]
    }
  }
}
```

## Tools

### Folder Management

| Tool | Description |
|------|-------------|
| `list_folders` | List all folders and labels |
| `create_folder` | Create a new folder (supports nesting with `/`) |
| `delete_folder` | Delete a folder (supports `dryRun` to preview first) |
| `rename_folder` | Rename or move a folder |
| `get_folder_stats` | Get total/unread counts for all folders |

### Reading Messages

| Tool | Description |
|------|-------------|
| `get_messages` | Paginated message list with metadata |
| `read_message` | Full message content by UID |
| `get_messages_with_snippets` | Message list with body preview snippets |
| `search_messages` | Search by sender, subject, date, body text — across multiple folders |
| `get_thread` | Get all messages in a conversation thread |
| `get_sender_summary` | Messages grouped by sender with counts and UIDs |
| `get_inbox_digest` | One-call overview: folder stats + top senders + counts |
| `get_unread_count` | Quick unread count for a single folder |

### Organizing Messages

| Tool | Description |
|------|-------------|
| `move_message` | Move a message to a different folder |
| `apply_label` | Copy a message to a label folder |
| `remove_label` | Remove a label from a message |
| `delete_message` | Move a message to Trash |
| `batch_move_messages` | Move up to 500 messages at once |
| `batch_apply_label` | Label up to 500 messages at once |
| `batch_delete_messages` | Trash up to 500 messages at once |
| `cross_folder_batch_move` | Move messages from multiple source folders to one destination |
| `move_by_sender` | Move all messages from a specific sender |
| `move_by_search` | Search + move in one call |

### Flags

| Tool | Description |
|------|-------------|
| `mark_read` / `mark_unread` | Toggle read status |
| `star_message` / `unstar_message` | Toggle star/flag |
| `batch_mark_read` / `batch_mark_unread` | Bulk read/unread (up to 500) |
| `mark_all_read` | Mark entire folder as read |

### Sending & Attachments

| Tool | Description |
|------|-------------|
| `send_email` | Send email via SMTP (supports HTML, CC/BCC, reply threading) |
| `get_attachment` | Download an attachment by part ID |

## Development

```bash
npm run dev       # Run with tsx (no build needed)
npm run build     # Compile TypeScript
npm test          # Run tests
```

## Security Notes

- Credentials are loaded from `.env` (gitignored — never committed)
- All input is validated with Zod schemas at the MCP boundary
- Batch operations are capped at 500 items
- Email addresses are validated before sending
- IMAP error messages are sanitized to prevent credential leakage
- `rejectUnauthorized: false` is used for TLS because Proton Bridge uses self-signed certificates on localhost

## License

MIT
