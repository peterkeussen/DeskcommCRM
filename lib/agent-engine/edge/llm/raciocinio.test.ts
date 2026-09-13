import { describe, expect, it } from "vitest";

import { opcoesSemRaciocinio } from "./raciocinio";

describe("opcoesSemRaciocinio", () => {
  it.each(["gemini-2.5-flash", "gemini-3.5-flash", "google/gemini-2.5-flash", "gemini-2.5-flash-lite"])(
    "%s: orçamento de raciocínio zero",
    (id) => {
      expect(opcoesSemRaciocinio(id)).toEqual({ google: { thinkingConfig: { thinkingBudget: 0 } } });
    },
  );

  it.each(["gemini-2.5-pro", "gemini-3.1-pro-preview"])("%s: família Pro exige raciocínio — nada muda", (id) => {
    expect(opcoesSemRaciocinio(id)).toBeUndefined();
  });

  it.each(["claude-haiku-4-5", "anthropic/claude-sonnet-5", "gpt-5.6-luna", "meta-llama/llama-3.3-70b-instruct"])(
    "%s: não é Gemini — nada é enviado",
    (id) => {
      expect(opcoesSemRaciocinio(id)).toBeUndefined();
    },
  );
});
