import type { z } from "zod";

/** Every model call in Study Coach goes through the Neon AI Gateway (OpenAI-compatible). */

export const MODELS = {
  smart: process.env.MODEL_SMART ?? "claude-sonnet-5",
  fast: process.env.MODEL_FAST ?? "gpt-5-mini",
  embed: process.env.MODEL_EMBED ?? "qwen3-embedding-0-6b", // 1024 dimensions
};

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

function gateway(): { base: string; token: string } {
  const base = process.env.NEON_AI_GATEWAY_BASE_URL;
  const token = process.env.NEON_AI_GATEWAY_TOKEN;
  if (!base || !token) throw new Error("NEON_AI_GATEWAY_BASE_URL and NEON_AI_GATEWAY_TOKEN must be set");
  return { base: base.replace(/\/+$/, ""), token };
}

async function post(path: string, body: unknown): Promise<any> {
  const { base, token } = gateway();
  const res = await fetch(`${base}/v1${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`AI Gateway ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

/** Streams the completion: the gateway answers 504 on non-streaming calls that run past ~60 s.
 *  A dropped stream or a 5xx is retried once, since both are usually transient. */
export async function chat(messages: ChatMessage[], opts: { model?: string } = {}): Promise<string> {
  try {
    return await streamChat(messages, opts.model ?? MODELS.smart);
  } catch (err) {
    if (!/stream_interrupted|stream error|AI Gateway 5\d\d/.test(String(err))) throw err;
    return streamChat(messages, opts.model ?? MODELS.smart);
  }
}

async function streamChat(messages: ChatMessage[], model: string): Promise<string> {
  const { base, token } = gateway();
  const res = await fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({ model, messages, stream: true }),
  });
  if (!res.ok || !res.body) throw new Error(`AI Gateway ${res.status}: ${(await res.text()).slice(0, 300)}`);

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  let text = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") return text;
      let chunk: any;
      try {
        chunk = JSON.parse(data);
      } catch {
        continue; // keep-alive or a partial frame
      }
      if (chunk.error) throw new Error(`AI Gateway stream error: ${JSON.stringify(chunk.error).slice(0, 300)}`);
      text += chunk.choices?.[0]?.delta?.content ?? "";
    }
  }
  return text;
}

/** Pull the outermost JSON object out of a model reply (tolerates code fences and stray prose). */
export function extractJSON(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** Ask for JSON matching `schema`; one corrective retry, then throw. */
export async function llmJSON<T>(args: {
  system: string;
  user: string;
  schema: z.ZodType<T>;
  model?: string;
}): Promise<T> {
  const messages: ChatMessage[] = [
    { role: "system", content: `${args.system}\n\nRespond with one JSON object only. No prose, no code fences.` },
    { role: "user", content: args.user },
  ];
  for (let attempt = 0; attempt < 2; attempt++) {
    const reply = await chat(messages, { model: args.model });
    const parsed = args.schema.safeParse(extractJSON(reply));
    if (parsed.success) return parsed.data;
    messages.push(
      { role: "assistant", content: reply },
      { role: "user", content: `That JSON did not match the schema: ${parsed.error.message.slice(0, 500)}. Return only the corrected JSON object.` },
    );
  }
  throw new Error("Model did not return valid JSON for the schema");
}

export async function embed(texts: string[]): Promise<number[][]> {
  const data = await post("/embeddings", { model: MODELS.embed, input: texts });
  return data.data.map((d: { embedding: number[] }) => d.embedding);
}
