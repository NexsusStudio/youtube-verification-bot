# YouTube Verification Bot (Discord.js v14)

Bot flow:
- Members use `/verify` with a YouTube channel/profile URL and screenshot.
- Requests are recorded as `WAITING` and sent to the private `verification-admin` channel.
- Server Owner or Admin/Owner role can Approve/Reject.
- Approve assigns `SUBSCRIBER`; Reject does not assign the role.
- The member receives a DM when possible and can reapply after rejection.
- `/setup-verification` creates roles and channels.

## 1. Create the Discord application
1. Open https://discord.com/developers/applications and create an application.
2. Open **Bot** and add a bot if needed. Copy the token only for KATABUMP Secrets; never put it in GitHub.
3. Enable **Server Members Intent** only if your bot dashboard or Discord setup requires it for your use case. This source uses GuildMembers to manage members/roles.
4. In **OAuth2 → General**, copy the Application ID (`CLIENT_ID`).
5. Invite the bot using OAuth2 URL Generator with scopes `bot` and `applications.commands`.
6. Bot permissions needed: View Channels, Send Messages, Embed Links, Attach Files, Read Message History, Use Slash Commands, Manage Roles, and Manage Channels (the last one is needed only for `/setup-verification`). Do not grant Administrator.
7. When inviting, make sure the bot role will be placed above `SUBSCRIBER` after setup. Do not place it above trusted human Owner/Admin roles.

## 2. Configure environment variables
Copy `.env.example` values into KATABUMP Environment Variables / Secrets:
- `DISCORD_TOKEN`: bot token
- `CLIENT_ID`: Application ID
- `GUILD_ID`: Discord server ID (enable Developer Mode, right-click server → Copy Server ID)
- `ADMIN_ROLE_IDS`: optional comma-separated IDs of the Admin and Owner roles. Leave blank to use role names exactly `Admin` and `Owner`, plus the server owner.

Never commit `.env` to GitHub. `.gitignore` excludes it.

## 3. Deploy slash commands
Run once after configuring the variables:
```bash
npm install
npm run deploy-commands
npm start
```
On KATABUMP, if it supports a startup command, use `npm start`. Run `npm run deploy-commands` once using its console/terminal or locally with the same environment variables. If KATABUMP has a separate install/start command setting, use `npm install` and `npm start`.

## 4. Set up roles and channels
1. Invite the bot to your server.
2. Start the bot and run `/setup-verification` as a server manager.
3. The bot creates `SUBSCRIBER`, `Admin`, `Owner`, category `VERIFICATION`, and channels `verification-submit` and `verification-admin`.
4. Assign `Admin` and `Owner` only to trusted staff. These roles are not given Administrator permissions automatically.
5. In **Server Settings → Roles**, move the bot's role above `SUBSCRIBER`.
6. Optionally set `ADMIN_ROLE_IDS` to the IDs of the trusted roles in KATABUMP. If you do this, include both Admin and Owner role IDs separated by a comma, then restart the bot.

## 5. Member instructions
Members go to `#verification-submit` and use:
`/verify youtube_link:https://www.youtube.com/@YourChannel screenshot:[attach image]`

The screenshot is sent to the private staff channel as an image URL in the review embed. Ask members to hide private information before uploading screenshots.

## Notes and limitations
- Request data is stored in `data/requests.json`. Make sure KATABUMP preserves the `data` directory across restarts/redeployments. If the host filesystem is ephemeral, requests may be lost after a redeploy. For production use, configure persistent storage or a database.
- Discord DMs can fail when a member disables DMs; the bot reports this to staff.
- The bot checks the URL format but cannot independently prove that a user subscribed to a YouTube channel. Staff must inspect the screenshot.
- The `/setup-verification` command requires Manage Server and the bot needs Manage Roles and Manage Channels. Don't grant Administrator.
- Do not expose bot tokens, screenshots, or private review channels publicly.
