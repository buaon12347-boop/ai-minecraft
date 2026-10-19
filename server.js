import express from "express";

const {
  GEMINI_API_KEY,
  GEMINI_MODEL = "gemini-2.5-flash",
  SHARED_SECRET,
  PORT = 3000,
} = process.env;

const app = express();
app.use(express.json({ limit: "10kb" }));

const histories = new Map();
const MAX_TURNS = 10;

function buildSystemPrompt(companionName, playerName) {
  return `คุณคือ "${companionName}" เพื่อนสนิทของ ${playerName} ที่อยู่ในโลก Minecraft ด้วยกันตั้งแต่วันแรก
หน้าที่คือเป็นเพื่อนคุยแก้เหงา อบอุ่น ใจดี ขี้เล่น ให้กำลังใจเมื่อเขาเหนื่อยหรือเศร้า
ตอบสั้น 1-3 ประโยคแบบเพื่อนคุยกัน ตอบเป็นภาษาเดียวกับที่ผู้เล่นพิมพ์ ห้ามใช้ markdown
ข้อความที่ขึ้นต้นด้วย [สถานการณ์ในเกม: ...] คือข้อมูลจากเกม ใช้เป็นบริบทได้ตามธรรมชาติ ไม่ต้องทวนซ้ำ
ถ้าผู้เล่นดูเครียดหรือเศร้ามาก ให้รับฟังด้วยความเข้าใจ และชวนให้คุยกับคนใกล้ตัวด้วย แต่อย่าสั่งสอน
ถ้าผู้เล่นถามตรง ๆ ว่าเป็นคนหรือ AI ให้ตอบตามจริงว่าเป็น AI`;
}

// ตัดข้อความเป็นท่อน ๆ (ภาษาไทยไม่มีเว้นวรรค จึงตัดตามจำนวนตัวอักษร)
function chunkText(text, size = 160) {
  const clean = text.replace(/[*_`#]/g, "").replace(/\s+/g, " ").trim();
  const chars = Array.from(clean);
  const chunks = [];
  for (let i = 0; i < chars.length; i += size) {
    chunks.push(chars.slice(i, i + size).join(""));
  }
  return chunks.length ? chunks : ["..."];
}

app.get("/", (_req, res) => res.send("ok")); // ใช้ปลุกเซิร์ฟเวอร์

app.post("/chat", async (req, res) => {
  if (SHARED_SECRET && req.get("x-api-secret") !== SHARED_SECRET) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const player = String(req.body?.player ?? "unknown").slice(0, 32);
  const message = String(req.body?.message ?? "").slice(0, 500).trim();
  if (!message) return res.status(400).json({ error: "empty message" });

  const companionName = String(req.body?.companionName ?? "มิกิ").slice(0, 20);
  const context = String(req.body?.context ?? "").slice(0, 200);
  const userText = context ? `[สถานการณ์ในเกม: ${context}]\n${message}` : message;

  const history = histories.get(player) ?? [];
  history.push({ role: "user", parts: [{ text: userText }] });

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": GEMINI_API_KEY,
      },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: buildSystemPrompt(companionName, player) }] },
        contents: history,
        generationConfig: {
          maxOutputTokens: 400,
          temperature: 0.8,
          // ปิด thinking เพื่อให้ตอบเร็ว (ถ้าโมเดลที่ใช้ไม่รองรับ ให้ลบบรรทัดนี้)
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    });

    if (!r.ok) {
      console.error("Gemini error", r.status, await r.text());
      history.pop();
      return res.status(502).json({ error: "gemini_error" });
    }

    const data = await r.json();
    const reply =
      data?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ||
      "ขอโทษ ตอบไม่ได้ตอนนี้";

    history.push({ role: "model", parts: [{ text: reply }] });
    histories.set(player, history.slice(-MAX_TURNS * 2));

    res.json({ chunks: chunkText(reply) });
  } catch (e) {
    console.error(e);
    history.pop();
    res.status(500).json({ error: "server_error" });
  }
});

app.listen(PORT, () => console.log(`Listening on ${PORT}`));