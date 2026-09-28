const { Client, GatewayIntentBits } = require("discord.js");
const http = require("http");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const BOT_TOKEN = "MTU1NDAxNzQyODA4MDU2NjI5Mg.GAAtQ5.Alekg0FwlRJB9qaricxJX3Vai_P27DdtNDwclI";
const TARGET_CHANNEL_ID = "1549854059262115972";
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbyf2TKvLXrkUWVrO3_KXS-ak7taXoC4I7Q7eEtqhgKQMn9y9_jHBmCV8V-aAPZXmGAwIw/exec";

client.once("clientReady", () => {
  console.log(`Bot connected 24/7 as: ${client.user.tag}`);
});

client.on("messageCreate", async (message) => {
  if (message.author.bot || message.channel.id !== TARGET_CHANNEL_ID) return;

  const payload = {
    timestamp: message.createdAt.toISOString(),
    author: message.author.tag || message.author.username,
    author_id: message.author.id,
    channel_id: message.channel.id,
    content: message.content,
    message_url: message.url,
  };

  try {
    const response = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      redirect: "follow",
    });

    const result = await response.json();
    console.log(`[Auto-Synced] ${message.author.username}:`, result);
  } catch (err) {
    console.error("Failed to push message:", err);
  }
});

// A dummy HTTP server so free web hosts keep it alive
const port = process.env.PORT || 3000;
http.createServer((req, res) => res.end("Bot is running 24/7")).listen(port, () => {
  console.log(`Health check listening on port ${port}`);
});

client.login(BOT_TOKEN);