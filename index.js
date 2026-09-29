const { Client, GatewayIntentBits, Events } = require("discord.js");
const http = require("http");
const dns = require("dns");

// Force IPv4 first to avoid silent IPv6 connection hangs in cloud environments
if (dns.setDefaultResultOrder) {
  dns.setDefaultResultOrder("ipv4first");
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// Credentials
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const TARGET_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID || "1549854059262115972";
const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL;

console.log("[Boot] Starting Discord Tracker Service...");
console.log(`[Boot] DISCORD_BOT_TOKEN set: ${Boolean(BOT_TOKEN)}`);
console.log(`[Boot] APPS_SCRIPT_URL set: ${Boolean(APPS_SCRIPT_URL)}`);
console.log(`[Boot] TARGET_CHANNEL_ID: ${TARGET_CHANNEL_ID}`);

if (!BOT_TOKEN || !APPS_SCRIPT_URL) {
  console.error("FATAL: Environment variables missing on server!");
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
client.on(Events.MessageCreate, async (message) => {
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

// Gateway Events
client.once(Events.ClientReady, (readyClient) => {
  console.log(`✅ [Discord Ready] Connected as: ${readyClient.user.tag}`);
  catchUpAudit();
  setInterval(catchUpAudit, 60 * 1000);
});

client.on("debug", (info) => {
  if (info.includes("Heartbeat") || info.includes("Session") || info.includes("Connecting")) {
    console.log(`[Gateway Debug] ${info}`);
  }
});

client.on("error", (err) => {
  console.error("❌ [Client Error]:", err);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
});

// HTTP Health Check Server for cron-job.org
const port = process.env.PORT || 10000;
const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ status: "healthy", timestamp: Date.now() }));
});

server.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});

async function startBot() {
  console.log("[Boot] Testing Discord REST API reachability...");
  try {
    const res = await fetch("https://discord.com/api/v10/gateway/bot", {
      headers: {
        Authorization: `Bot ${BOT_TOKEN.trim()}`,
      },
    });

    console.log(`[Boot] Discord API HTTP Status: ${res.status} ${res.statusText}`);
    const data = await res.json();
    console.log("[Boot] Gateway URL:", data.url);

    if (res.status === 401) {
      console.error("❌ FATAL: Token is invalid or revoked!");
      return;
    }

    console.log("[Boot] Logging into Gateway via Client...");
    await client.login(BOT_TOKEN.trim());
    console.log("[Boot] Client login function resolved successfully.");
  } catch (err) {
    console.error("❌ [Connection Error]:", err);
  }
}

startBot();