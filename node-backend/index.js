// index.js
import { createClient } from "@deepgram/sdk";
import { WebSocketServer } from "ws";
import dotenv from "dotenv";
import fetch from "node-fetch";

dotenv.config();

const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY;

if (!DEEPGRAM_API_KEY) {
  console.error("❌ Missing Deepgram API key in .env");
  process.exit(1);
}

const deepgram = createClient(DEEPGRAM_API_KEY);

// Start WebSocket server
const wss = new WebSocketServer({ port: 3001 });
console.log("🚀 WebSocket server running on ws://localhost:3001");

wss.on("connection", async (ws) => {
  console.log("⚡ Client connected for transcription");

  let aslMode = false;
  let buffer = "";
  let pauseTimer = null;

  // ✅ Deepgram live connection
  const dgConnection = deepgram.listen.live({
    model: "nova-2",
    language: "en-US",
    encoding: "linear16",
    sample_rate: 16000,
    smart_format: true,
  });

  dgConnection.on("open", () => console.log("✅ Deepgram connection opened"));
  dgConnection.on("close", () => console.log("🛑 Deepgram connection closed"));
  dgConnection.on("error", (err) => console.error("❌ Deepgram error:", err));

  // Handle transcripts from Deepgram
  dgConnection.on("Results", (data) => {
    console.log('[DG TRANSCRIPT EVENT]', JSON.stringify(data));
    
    try {
      if (
        data &&
        data.channel &&
        data.channel.alternatives &&
        data.channel.alternatives[0] &&
        data.channel.alternatives[0].transcript
      ) {
        const text = data.channel.alternatives[0].transcript.trim();
        
        if (text) {
          console.log("📝 Transcription:", text);
          ws.send(text);

          // Buffer for ASL gloss
          buffer += (buffer ? " " : "") + text;

          // Reset pause timer
          if (pauseTimer) clearTimeout(pauseTimer);
          
          pauseTimer = setTimeout(async () => {
            console.log(`[PAUSE TRIGGERED] ASL Mode: ${aslMode}, Buffer: "${buffer.trim()}"`);
            if (aslMode && buffer.trim()) {
              console.log("[ASL REQUEST] Sending to Ollama:", buffer.trim());
              const gloss = await getASLGloss(buffer.trim());
              console.log("[ASL RESPONSE] Gloss:", gloss);
              if (gloss) {
                ws.send(JSON.stringify({ type: "aslGloss", gloss }));
              } else {
                console.log("[ASL WARNING] Empty gloss returned from Ollama");
              }
            }
            buffer = "";
          }, 1500); // 1.5s pause
        }
      }
    } catch (err) {
      console.error("⚠️ Transcript parse error:", err);
    }
  });

  // Handle audio & ASL mode messages from frontend
  ws.on("message", (message) => {
    // Check if this might be a JSON message first
    let messageStr = null;
    try {
      if (Buffer.isBuffer(message)) {
        // Try to decode as string
        messageStr = message.toString('utf8');
        // If it starts with { it's probably JSON
        if (messageStr.startsWith('{')) {
          const msg = JSON.parse(messageStr);
          console.log("[JSON MESSAGE RECEIVED]", msg);
          if (msg.type === "aslMode") {
            aslMode = !!msg.enabled;
            console.log(`[ASL MODE SET] ${aslMode}`);
          }
          return; // Don't send to Deepgram
        }
      }
    } catch (err) {
      // Not JSON, must be audio
    }
    
    // If we get here, it's audio data
    if (Math.random() < 0.05) { // Log 5% of audio packets
      console.log(`[AUDIO RECEIVED] Buffer (${message.length} bytes)`);
    }
    dgConnection.send(message);
  });

  ws.on("close", () => {
    console.log("❌ Client disconnected");
    dgConnection.finish();
    if (pauseTimer) clearTimeout(pauseTimer);
  });
});

// -------------------------------
// Helper: Send text to Ollama for ASL gloss
// -------------------------------
async function getASLGloss(text) {
  try {
    const response = await fetch("http://localhost:11434/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "phi3:latest",
        prompt: `Convert this sentence into ASL gloss (uppercase, concise, correct syntax): "${text}"`,
        stream: false
      }),
    });

    if (!response.ok) {
      console.error("❌ Ollama request failed:", response.statusText);
      return "";
    }

    const data = await response.json();
    return data?.response?.trim() || "";
  } catch (err) {
    console.error("⚠️ Ollama request error:", err);
    return "";
  }
}