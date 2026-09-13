# lib/ai/

Camada de IA do CRM. Este arquivo não lista números nem modelos — eles mudam.
Para saber o estado, rode o comando ao lado de cada pergunta.

## Onde está cada coisa

- **Quais pontos usam IA, e o que acontece se falharem:** `lib/ai/pontos/registro.ts`.
  É a lista única. `tests/unit/pontos-de-ia-completude.test.ts` reprova ponto que o
  código chama e não está lá, e também ponto que está lá e ninguém chama.
- **Quais provedores a tela oferece** (Anthropic, OpenAI, Google/Gemini, OpenRouter):
  `lib/ai/pontos/provedores.ts`.
- **Qual modelo e qual chave cada ponto usa:** está no banco, por organização
  (`ai_purpose_bindings` + `ai_provider_credentials`), e se configura em
  **IA › Provedores** e **IA › Credenciais**. Mudar ali não exige reiniciar nada.
- **A porta única de chamada:** `lib/agent-engine/edge/llm/run-model-call.ts`
  (`runModelCall`). Ela cuida de orçamento, telemetria em `llm_calls`, erro
  normalizado, timeout/retentativa (`timeoutMs`, `maxRetries`) e máscara de dado
  pessoal (`mascararPii`).
- **A pilha antiga** (workers em Supabase): `lib/ai/gateway-binding.ts` →
  `resolverModeloDoPonto`. Ela obedece ao mesmo painel.
- **Preço por token:** `lib/agent-engine/edge/llm/pricing.ts` (seam) e a tabela
  `ai_pricing` (pilha antiga).
- **Assistente do atendente** (recursos que trabalham para quem atende):
  `lib/ai/copilot/`. O liga/desliga fica em `organizations.settings.ai_copilot`.

## Chaves de plataforma no `.env`

`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY` e `GEMINI_API_KEY` são
todas opcionais e são o **último degrau**: a credencial cadastrada pela organização
vale mais que qualquer uma delas. Não existe `GEMINI_MODEL`: o modelo de cada ponto
é escolhido na tela e fica no banco.

```bash
grep -n "API_KEY" lib/env.ts
```
