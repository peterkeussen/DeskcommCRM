/** Controlled provider for the existing INTERNAL_AGENT_RUN_STUB QA switch.
 * Only substitutes the provider seam: tools, retrieval, gates and closing remain real.
 */
import { randomUUID } from 'node:crypto';
import { createFakeRegistry } from '../edge/llm/providers';
export function previewFixtureRegistry() {
  return createFakeRegistry(async (options) => {
    const text = JSON.stringify(options.prompt);
    const toolResults = options.prompt.filter((m) => m.role === 'tool').flatMap((m) => m.content);
    const saw = (name: string) => toolResults.some((r) => 'toolName' in r && r.toolName === name);
    const content: Array<
      | { type: 'text'; text: string }
      | { type: 'tool-call'; toolCallId: string; toolName: string; input: string }
    > = [];
    // Assistente do atendente (lib/ai/copilot/): o resumo responde em texto de 4
    // linhas e as alternativas em JSON. Reconhecidos pelo PROMPT de cada ponto,
    // como os dois ramos abaixo — nada aqui decide o que a tela mostra.
    if (!options.tools?.length && text.includes('Você resume conversas de atendimento')) {
      content.push({
        type: 'text',
        text: 'Motivo: informações do atendimento\nJá feito: nada\nPendente: responder o cliente\nClima: calmo — pergunta simples',
      });
    } else if (!options.tools?.length && text.includes('Resposta base:')) {
      content.push({
        type: 'text',
        text: JSON.stringify({
          alternativas: [
            'Olá! Posso ajudar com as informações do atendimento.',
            'Oi, que bom falar com você! Posso ajudar com as informações do atendimento. O que você gostaria de saber?',
          ],
        }),
      });
    } else if (!options.tools?.length) {
      const value = text.includes('Turno interno de memória')
        ? {
            notes: [
              { headline: 'Preferência do cenário', body: 'Atendimento com confirmação humana.' },
            ],
          }
        : text.includes('Compacte a conversa')
          ? {
              commitments: [],
              objections: [],
              personal_data: [],
              stage: null,
              rolling_summary: 'Cenário resumido para revisão.',
            }
          : {
              commitments: [],
              objections: [],
              next_action: null,
              rolling_summary: 'Resposta proposta para revisão humana.',
              declaracao: { promessas: [] },
            };
      content.push({ type: 'text', text: JSON.stringify(value) });
    } else {
      const has = (name: string) =>
        options.tools?.some((t) => t.type === 'function' && t.name === name);
      const name =
        has('search_knowledge') && !saw('search_knowledge')
          ? 'search_knowledge'
          : !saw('send_message')
            ? 'send_message'
            : null;
      if (name)
        content.push({
          type: 'tool-call',
          toolCallId: randomUUID(),
          toolName: name,
          input: JSON.stringify(
            name === 'search_knowledge'
              ? { query: 'informações de atendimento' }
              : {
                  body: 'Olá! Posso ajudar com as informações do atendimento. O que você gostaria de saber?',
                },
          ),
        });
      else content.push({ type: 'text', text: 'Sugestão registrada.' });
    }
    return {
      content,
      finishReason: {
        unified: content[0]?.type === 'tool-call' ? 'tool-calls' : 'stop',
        raw: undefined,
      },
      usage: {
        inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 1, text: 1, reasoning: 0 },
      },
      warnings: [],
    };
  });
}
