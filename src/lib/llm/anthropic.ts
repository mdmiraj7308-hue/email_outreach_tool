import Anthropic from "@anthropic-ai/sdk";

export async function completeWithAnthropic(
  apiKey: string,
  model: string,
  system: string,
  user: string
): Promise<string> {
  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model,
    max_tokens: 2000,
    system,
    messages: [{ role: "user", content: user }],
  });
  const textBlock = response.content.find((block) => block.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Anthropic response contained no text content");
  }
  return textBlock.text;
}
