const { Client, GatewayIntentBits } = require("discord.js");
const http = require("http");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// Load configuration
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const TARGET_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID || "1549854059262115972";
const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL;

if (!BOT_TOKEN || !APPS_SCRIPT_URL) {
  console.error("FATAL: DISCORD_BOT_TOKEN or APPS_SCRIPT_URL is missing.");
  process.exit(1);
}

// In-memory deduplication set
const processedIds = new Set();
function markProcessed(id) {
  if (processedIds.has(id)) return true;
  processedIds.add(id);
  if (processedIds.size > 500) {
    const oldest = processedIds.values().next().value;
    processedIds.delete(oldest);
  }
  return false;
}

// Resilient forwarder
async function forwardMessage(message, maxAttempts = 3) {
  if (markProcessed(message.id)) return;

  const payload = {
    timestamp: message.createdAt.toISOString(),
    author: message.author.tag || message.author.username,
    author_id: message.author.id,
    channel_id: message.channel.id,
    content: message.content,
    message_url: message.url,
  };

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(APPS_SCRIPT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        redirect: "follow",
      });

      const res = await response.json();
      if (res.status === "success") {
        console.log(`[Synced] ${message.author.username}: "${message.content.substring(0, 32).replace(/\n/g, " ")}..."`);
        return;
      }
      throw new Error(res.error || "Unknown Apps Script response");
    } catch (err) {
      console.warn(`[Attempt ${attempt}/${maxAttempts} Failed]: ${err.message}`);
      if (attempt === maxAttempts) {
        console.error(`[Dropped] Could not sync message ${message.id}`);
      } else {
        await new Promise((r) => setTimeout(r, 2000 * attempt));
      }
    }
  }
}

// Real-time listener
client.on("messageCreate", async (message) => {
  if (message.author.bot || message.channel.id !== TARGET_CHANNEL_ID) return;
  await forwardMessage(message);
});

// Periodic catch-up audit
async function catchUpAudit() {
  try {
    const channel = await client.channels.fetch(TARGET_CHANNEL_ID);
    if (!channel || !channel.isTextBased()) return;

    const recent = await channel.messages.fetch({ limit: 15 });
    const chronological = Array.from(recent.values()).reverse();

    for (const msg of chronological) {
      if (!msg.author.bot) {
        await forwardMessage(msg);
      }
    }
  } catch (err) {
    console.error("[Audit Error]:", err.message);
  }
}

client.once("clientReady", () => {
  console.log(`Bot connected as ${client.user.tag}`);
  catchUpAudit();
  setInterval(catchUpAudit, 60 * 1000);
});

// Global crash handlers to prevent process exit
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
});

// HTTP Health Check Server
const port = process.env.PORT || 3000;
const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ status: "healthy", timestamp: Date.now() }));
});

server.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});

client.login(BOT_TOKEN);