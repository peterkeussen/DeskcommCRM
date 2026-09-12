---
impacto: nada_mudou
secao: corrigido
titulo: Testar um agente de IA deixa de mostrar "Erro inesperado" numa resposta demorada
---

O botão "Testar" do agente chamava a API com o timeout padrão do cliente HTTP, de 10
segundos — curto demais para uma execução real de LLM, que naturalmente passa disso. Quando
passava, o navegador cancelava a chamada, e como o cancelamento não vinha como erro
estruturado da API, a tela caía no genérico "Erro inesperado.", sem dizer que era um tempo
esgotado nem dar qualquer pista de causa.

Separadamente, quando a execução falhava de verdade, a rota tentava marcar a run como
`status = 'error'` — valor que a constraint do banco (`ai_agent_runs_status_check`) não
aceita. O `update` falhava em silêncio (o erro não era conferido) e a run ficava presa em
`running` para sempre, poluindo o histórico de execuções do agente.

Agora o teste usa um timeout de 120 segundos, compatível com o tempo real de uma chamada de
IA, e a rota grava `completed`/`failed` — os mesmos valores que o resto do produto já usa e
que a constraint do banco aceita.
