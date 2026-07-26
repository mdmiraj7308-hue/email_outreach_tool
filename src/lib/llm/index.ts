import type { Settings } from "@/generated/prisma/client";
import { completeWithAnthropic } from "@/lib/llm/anthropic";
import { completeWithOpenAI } from "@/lib/llm/openai";
import { DEFAULT_ANTHROPIC_MODEL, DEFAULT_OPENAI_MODEL } from "@/lib/constants";

export interface LlmClient {
  complete(system: string, user: string): Promise<string>;
}

export function getActiveLlmClient(settings: Settings): LlmClient {
  if (settings.activeLlmProvider === "openai") {
    if (!settings.openaiApiKey) {
      throw new Error("OpenAI is the active provider but no API key is configured in Settings.");
    }
    const model = settings.openaiModel || DEFAULT_OPENAI_MODEL;
    return {
      complete: (system, user) => completeWithOpenAI(settings.openaiApiKey!, model, system, user),
    };
  }

  if (settings.activeLlmProvider === "anthropic") {
    if (!settings.anthropicApiKey) {
      throw new Error("Anthropic is the active provider but no API key is configured in Settings.");
    }
    const model = settings.anthropicModel || DEFAULT_ANTHROPIC_MODEL;
    return {
      complete: (system, user) =>
        completeWithAnthropic(settings.anthropicApiKey!, model, system, user),
    };
  }

  throw new Error("No active LLM provider is configured in Settings.");
}
