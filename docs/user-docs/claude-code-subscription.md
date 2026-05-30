# Use Claude Code With a Claude Subscription

Last verified: 2026-05-30

This guide is for users who have a Claude Pro, Max, Team, or Enterprise subscription and want to use that subscription with Claude Code and GSD.

The short version:

1. Install Anthropic's official Claude Code CLI.
2. Run `claude`.
3. Inside Claude Code, run `/login` and sign in with the Claude account that owns the subscription.
4. Start GSD and choose the Claude Code CLI provider, or let GSD auto-detect the authenticated local CLI.

GSD does not ask for, store, or replay Claude subscription OAuth credentials. Subscription login happens inside Anthropic's own `claude` CLI.

## Prerequisites

- A Claude subscription: Pro, Max, Team, or Enterprise.
- A terminal or command prompt.
- A project directory you want Claude Code or GSD to work in.
- For the npm install path only: Node.js 18 or later.

If you are using a work account, complete your organization's SSO or invitation flow first.

## Step 1: Install Claude Code CLI

Use one of the official install methods below.

### macOS, Linux, or WSL

Recommended native installer:

```bash
curl -fsSL https://claude.ai/install.sh | bash
```

Homebrew:

```bash
brew install --cask claude-code
```

npm:

```bash
npm install -g @anthropic-ai/claude-code
```

Do not run the npm install with `sudo`. If npm reports permission errors, use the native installer or fix your npm global prefix instead of installing as root.

### Windows PowerShell

```powershell
irm https://claude.ai/install.ps1 | iex
```

### Windows CMD

```cmd
curl -fsSL https://claude.ai/install.cmd -o install.cmd && install.cmd && del install.cmd
```

Git for Windows is recommended on native Windows so Claude Code can use a Bash-compatible shell. Without it, Claude Code falls back to PowerShell for shell commands.

## Step 2: Verify the CLI

Restart your terminal if the install changed your `PATH`, then run:

```bash
claude --version
```

On macOS, Linux, or WSL, you can also check where the binary is coming from:

```bash
command -v claude
```

On Windows:

```powershell
where.exe claude
```

If `claude` is not found, restart the terminal first. If it still fails, reinstall with the native installer for your platform.

## Step 3: Log In With Your Subscription

Start Claude Code:

```bash
claude
```

If this is your first run, Claude Code prompts you to authenticate in the browser. Sign in with the same Claude account that has your subscription.

If you are already inside Claude Code, or need to switch accounts, type this at the start of a Claude Code message:

```text
/login
```

Follow the browser flow and approve the login. Team and Enterprise users may also see an SSO prompt.

After login, Claude Code stores credentials locally so you do not need to log in every session.

## Step 4: Confirm the Right Auth Method

Inside Claude Code, run:

```text
/status
```

Use this to confirm the active account, model, version, and authentication state.

If you expected subscription auth but Claude Code appears to be using another account or API billing instead, check whether an environment variable is overriding your `/login` credentials:

```bash
env | grep ANTHROPIC
```

For a clean interactive `/login` session, unset credential variables before starting Claude Code:

```bash
unset ANTHROPIC_API_KEY
unset ANTHROPIC_AUTH_TOKEN
unset CLAUDE_CODE_OAUTH_TOKEN
claude
```

If those variables come back in new terminals, remove them from `~/.zshrc`, `~/.bashrc`, `~/.profile`, or your Windows PowerShell profile.

## Step 5: Use Claude Code in a Project

Open a project directory and start Claude Code there:

```bash
cd /path/to/your/project
claude
```

Good first prompts:

```text
what does this project do?
explain the folder structure
where is the main entry point?
find the tests for the CLI
```

Useful Claude Code commands:

| Command | Use |
| --- | --- |
| `/help` | Show available commands. |
| `/status` | Check account, model, version, and connectivity. |
| `/login` | Log in, re-authenticate, or switch accounts. |
| `/init` | Create a starter `CLAUDE.md` for project instructions. |
| `/memory` | View and edit loaded memory files. |
| `/permissions` | Review or change tool approval rules. |
| `/resume` | Continue a previous conversation. |

Before asking Claude Code to make changes, run:

```bash
git status --short
```

This makes it easier to tell which changes were already present and which changes Claude Code made during the session.

## Step 6: Use Your Subscription Through GSD

There are two supported ways to pair a Claude subscription with GSD.

### Option A: Run GSD With the Local Claude Code Provider

Install and log in to Claude Code first:

```bash
claude
```

Inside Claude Code:

```text
/login
```

Then start GSD:

```bash
gsd
```

During setup, choose the Claude Code CLI provider if prompted. If you already skipped setup, run `/login` inside GSD and choose Claude Code CLI.

When this provider is active, GSD routes through the user's authenticated local Claude Code runtime. GSD does not perform Claude subscription OAuth itself.

### Option B: Use GSD Tools From Inside Claude Code

If you prefer to stay in Claude Code and call GSD's workflow tools from there, configure the GSD MCP server.

Automatic setup:

1. Start GSD once with the Claude Code provider selected.
2. GSD writes or updates the project `.mcp.json`.
3. Restart Claude Code in that project.
4. In Claude Code, run `/mcp` to confirm the server is loaded.

Manual setup from inside GSD:

```text
/gsd mcp init
```

Then restart Claude Code and ask it to use the GSD workflow tools for planning, milestones, auto-mode sessions, or project status.

## Working Safely

- Keep subscription login inside Claude Code. Do not paste Claude subscription tokens into GSD, shell profiles, scripts, or CI.
- Use Claude Console API keys only when you want direct API-billed Anthropic access.
- Review file edits before committing.
- Let Claude Code run tests, but inspect failures yourself before accepting a fix.
- Use `/permissions` if you want tighter approval prompts before edits or shell commands.
- Use small, specific tasks when starting out. Example: "Add a failing test for X, then implement the smallest fix."

## Troubleshooting

### `claude: command not found`

Restart the terminal, then run `claude --version` again. If it still fails, reinstall with the native installer or check that your package manager's global binary directory is on `PATH`.

### npm permission errors

Do not use `sudo npm install -g @anthropic-ai/claude-code`. Use the native installer, Homebrew, or fix your npm global prefix.

### Browser login does not complete

This can happen in WSL, SSH sessions, containers, and remote machines. Copy the login URL into a local browser if prompted, then paste the returned code back into the terminal.

If pasting into the interactive prompt does not work, use:

```bash
claude auth login
```

### Wrong account or wrong billing method

Inside Claude Code, run:

```text
/login
/status
```

If Claude Code still uses the wrong credentials, unset `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, and `CLAUDE_CODE_OAUTH_TOKEN`, then remove those exports from your shell profile.

### Subscription is active but login is rejected

Check the subscription on `claude.ai/settings`, confirm you are signing into the same account, and retry `/login`. For Team or Enterprise accounts, confirm that your organization invite or SSO access is active.

### Upgrade Claude Code

Native installs auto-update in the background.

Homebrew:

```bash
brew upgrade claude-code
```

WinGet:

```powershell
winget upgrade Anthropic.ClaudeCode
```

npm:

```bash
npm install -g @anthropic-ai/claude-code@latest
```

## Official References

- [Claude Code quickstart](https://code.claude.com/docs/en/quickstart)
- [Claude Code setup](https://code.claude.com/docs/en/setup)
- [Claude Code authentication](https://code.claude.com/docs/en/authentication)
- [Claude Code commands](https://code.claude.com/docs/en/commands)
- [Claude Code permissions](https://code.claude.com/docs/en/permissions)
- [Claude Code troubleshooting](https://code.claude.com/docs/en/troubleshoot-install)
