# Publishing AgentData MCP

## Preflight

If this checkout still tracks the legacy `node_modules` tree, remove it from Git once before publishing:

```bash
git rm -r --cached node_modules
git add .gitignore
```

```bash
cd /home/pete/cryptoanalyse/agentdata-mcp
npm ci
npm test
npm run check-docs
npm run check-catalogue
npm pack --dry-run
```

`prepublishOnly` repeats the tests and both drift checks. Publication must stop if the live service and package catalogue differ.

## Synchronize a changed catalogue

After the corresponding API route is deployed:

```bash
npm run sync-docs
npm run check-catalogue
```

Review `README.md` and `server.json`, then increment the package version in `package.json`.

## Publish npm

```bash
npm login
npm publish --access public
```

Verify that a clean machine can resolve and start the exact published version.
Run it through `npx`, not `node index.js`: 1.2.0 shipped an entry check that
matched only the real path, so the binary exited 0 in silence under every MCP
client while direct invocation worked fine.

```bash
npx -y agentdata-mcp@$(node -p "require('./package.json').version")
```

## Publish MCP Registry metadata

```bash
/tmp/mcp-publisher login github
/tmp/mcp-publisher publish
```

The registry metadata lives in `server.json`. Its version is checked against `package.json` by `npm run check-docs`.
