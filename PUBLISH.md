# MCP Registry Publishing Instructions

## Prerequisites

1. **GitHub Account** with a repo named `mcp-server` under organization/user
2. **npm Account** (can be free tier)

## Step 1: Create GitHub repo

Create `https://github.com/YOUR_USERNAME/mcp-server` (or similar), push this directory.

Update `server.json` → `name` and `repository.url` accordingly.

## Step 2: Publish npm package

```bash
cd /home/pete/cryptoanalyse/x402-mcp-server
npm login
npm publish --access public
```

## Step 3: Register on MCP Registry

```bash
cd /home/pete/cryptoanalyse/x402-mcp-server
/tmp/mcp-publisher login github    # opens browser for OAuth
/tmp/mcp-publisher publish          # submits server.json
```

## Verification

After publish, check:
- https://registry.modelcontextprotocol.io/servers (or the registry browser)
- Your entry should appear by name (`io.github.YOUR_USERNAME/mcp-server`)

## Testing locally (optional)

Before publishing, test with Claude Desktop:

1. Open `~/.claude/claude_desktop_config.json`
2. Add:
```json
{
  "mcpServers": {
    "agentdata": {
      "command": "node",
      "args": ["/home/pete/cryptoanalyse/x402-mcp-server/index.js"]
    }
  }
}
```
3. Restart Claude Desktop, ask: "What crypto tools do you have?"
