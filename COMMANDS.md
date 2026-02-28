# NanoClaw Commands

## Service Management

```bash
# Stop
launchctl unload ~/Library/LaunchAgents/com.nanoclaw.plist

# Start
launchctl load ~/Library/LaunchAgents/com.nanoclaw.plist

# Restart
launchctl kickstart -k gui/$(id -u)/com.nanoclaw

# Check status
launchctl list | grep nanoclaw
```

## Logs

```bash
# Live log
tail -f logs/nanoclaw.log

# Errors
tail -f logs/nanoclaw.error.log

# Setup log
tail -f logs/setup.log
```

## Container Runtime (Apple Container)

```bash
# Check status
container system status

# Start
container system start

# List running containers
container ls

# Rebuild agent image
./container/build.sh

# Force clean rebuild (clears cache)
container builder stop && container builder rm && container builder start
./container/build.sh
```

## Development

```bash
# Run with hot reload (instead of service)
npm run dev

# Build TypeScript
npm run build

# Run tests
npm test
```

## WhatsApp

```bash
# Re-authenticate WhatsApp
npm run auth
```

## Skills (run inside Claude Code)

| Command | Purpose |
|---------|---------|
| `/setup` | Run or re-run setup |
| `/update` | Pull upstream NanoClaw changes |
| `/customize` | Add channels, integrations, modify behavior |
| `/debug` | Diagnose container/service issues |

## Config Files

| File | Purpose |
|------|---------|
| `.env` | API keys, model, assistant name |
| `groups/main/CLAUDE.md` | Agent memory and instructions for main channel |
| `groups/global/CLAUDE.md` | Shared instructions across all channels |
| `~/.config/nanoclaw/mount-allowlist.json` | Directory access rules for agents |

## Model

Change the default model in `.env`:

```
ANTHROPIC_MODEL=claude-haiku-4-5-20251001   # fast, cheap (current)
ANTHROPIC_MODEL=claude-sonnet-4-6            # smarter, costs more
ANTHROPIC_MODEL=claude-opus-4-6              # most capable, most expensive
```

Restart the service after changing `.env`.
