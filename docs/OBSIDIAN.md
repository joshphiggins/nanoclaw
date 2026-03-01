# Obsidian Integration

NanoClaw syncs GTD data and captures to an Obsidian vault via iCloud, giving you read/write access to your task system from your phone without Obsidian Sync.

## How It Works

```
┌──────────────┐     iCloud      ┌──────────────┐
│  Your Phone  │ ◄─────────────► │   Mac Host    │
│  (Obsidian)  │                 │  iCloud Drive │
└──────────────┘                 └──────┬───────┘
                                        │ bind-mount
                                 ┌──────▼───────┐
                                 │  Linux Agent  │
                                 │  Container    │
                                 │               │
                                 │ /workspace/extra/obsidian/
                                 └───────────────┘
```

The Obsidian vault (`JPH`) lives on the Mac at `~/Library/Mobile Documents/iCloud~md~obsidian/Documents/JPH`. It's bind-mounted into the agent container at `/workspace/extra/obsidian/`. iCloud handles sync to your phone — no extra services needed.

## Vault Structure

```
JPH/
├── GTD/
│   └── tasks.md          ← auto-synced copy of gtd.md (read on phone)
├── Inbox/
│   ├── 2026-02-28.md     ← WhatsApp inline captures (timestamped bullets)
│   ├── quick-note.md     ← notes you create on your phone
│   └── Processed/
│       └── 2026-02/      ← processed inbox files moved here
├── Daily/
│   └── 2026-02-28.md     ← daily focus note (generated 8:45 AM)
└── Reviews/
    └── 2026-W09.md       ← weekly review summary (generated Fridays)
```

## Data Flows

### 1. GTD on Your Phone (automatic)

Every time the agent edits `gtd.md`, it copies the file to `obsidian/GTD/tasks.md` using atomic write (temp file + `mv`). Open Obsidian on your phone → GTD folder → `tasks.md` to see your current task lists with full formatting.

**Direction:** Agent → Obsidian (one-way mirror)

### 2. WhatsApp Inline Capture

When you send poke a fleeting thought in WhatsApp, the agent:
1. Processes it normally (classifies, routes to GTD if actionable)
2. Appends a timestamped bullet to `obsidian/Inbox/YYYY-MM-DD.md`

This gives you a daily log of captures in Obsidian for reference.

**Direction:** WhatsApp → Agent → Obsidian + GTD

### 3. Phone-to-GTD Pipeline (Obsidian Inbox)

For when you want to capture something directly in Obsidian on your phone:

1. Open Obsidian → create a new note in `Inbox/`
2. Write or dictate freely — no special format needed
3. Save and close
4. Within 15 minutes, the agent picks it up and:
   - Classifies the content (task, idea, or note)
   - Routes it to the right GTD list in `gtd.md`
   - Moves the file to `Inbox/Processed/YYYY-MM/`
   - Sends you a WhatsApp confirmation

**Direction:** Obsidian → Agent → GTD → WhatsApp confirmation

**Safety features:**
- Files modified less than 60 seconds ago are skipped (you might still be typing)
- iCloud conflict files (filename contains "conflict") are quarantined to `Inbox/Conflicts/` with a WhatsApp alert
- Unclassifiable content goes to GTD Inbox tagged `[obsidian-unclassified]` rather than being lost

### 4. Daily Note (8:45 AM)

The agent generates a daily note before the morning digest with:
- Top 3 next actions from `gtd.md`
- Items processed from the Obsidian Inbox since the last note

Open `Daily/` in Obsidian to see your focus for the day.

**Direction:** Agent → Obsidian

### 5. Weekly Review Archive (Fridays)

After the Friday weekly review, the agent writes a structured summary to `Reviews/YYYY-Wnn.md` with completed tasks, key decisions, and next week's focus. Builds searchable long-term history.

**Direction:** Agent → Obsidian

### 6. Vault Search

Ask poke "what did I note about X?" and it searches the entire mounted vault with grep. No extra setup — works because the vault is mounted.

**Direction:** Obsidian → Agent → WhatsApp

## Scheduled Tasks

| Task | Schedule | What It Does |
|------|----------|--------------|
| `obsidian-inbox-check` | Every 15 min | Processes new files in `Inbox/` |
| `obsidian-daily-note` | 8:45 AM daily | Generates daily focus note |
| Weekly review | Fridays 4 PM | Also writes `Reviews/` note (existing task, extended) |

## Monitoring

The weekday morning digest includes a vault health line:

```
🔗 VAULT: mounted | last sync: 2026-02-28 08:32
```

If the vault isn't mounted or `GTD/tasks.md` is stale (>24h), it shows up in the ALERTS section.

## iCloud Considerations

- **"Keep Downloaded"**: Mark `Inbox/`, `GTD/`, and `Daily/` as "Keep Downloaded" in Finder (right-click → Keep Downloaded). This prevents iCloud from evicting files that the container needs.
- **Sync lag**: iCloud typically syncs within seconds to a few minutes. The 60-second grace period on inbox processing accounts for this.
- **Conflicts**: If you edit a file on your phone while iCloud is syncing a version from the agent, iCloud creates a conflict file. The agent detects these and quarantines them instead of blindly processing.
- **No `brctl`**: The agent runs in a Linux container — macOS-only tools aren't available. All file operations use standard POSIX commands.

## Security

The mount allowlist (`~/.config/nanoclaw/mount-allowlist.json`) scopes access to the specific vault path, not the parent Obsidian directory. The `nonMainReadOnly` flag ensures non-main groups can't write to it.
