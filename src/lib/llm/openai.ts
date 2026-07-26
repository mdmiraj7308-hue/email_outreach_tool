import OpenAI from "openai";

export async function completeWithOpenAI(
  apiKey: string,
  model: string,
  system: string,
  user: string
): Promise<string> {
  const client = new OpenAI({ apiKey });
  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });
  const text = response.choices[0]?.message?.content;
  if (!text) {
    throw new Error("OpenAI response contained no text content");
  }
  return text;
}
