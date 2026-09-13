---
impacto: capacidade_nova
secao: adicionado
titulo: Gemini de ponta a ponta e dados pessoais mascarados antes de ir para a IA
---

Em **IA › Provedores** aparece o cartão **Assistente do atendente**, com dois
controles.

O primeiro é o atalho **Usar nestes recursos: Gemini 3.5 Flash**. Com uma chave do
Google cadastrada em IA › Credenciais, um clique passa a medição do clima da
conversa para o Gemini — sem editar arquivo e sem reiniciar nada. Antes, uma
organização cujo único provedor era a chave cadastrada na tela não tinha o clima
da conversa medido: a verificação olhava só o `.env`. Isso foi corrigido, e o custo
das chamadas ao Gemini 2.5 (Flash, Flash-Lite e Pro) e ao Gemini 3.5 Flash agora entra no Uso de IA e no
teto de orçamento.

O segundo é **Mascarar dados pessoais antes de enviar à IA**, que já vem ligado.
CPF, e-mail, telefone e CEP são trocados por marcadores nas leituras que a IA faz da
conversa. O que o agente escreve para o cliente não é afetado. Quem administra
pode desligar.

Para quem prefere configurar pelo servidor, o `.env` aceita `GEMINI_API_KEY`
(opcional) como chave de plataforma, igual às dos outros provedores. A chave
cadastrada na tela continua valendo mais que ela.

Você não precisa fazer nada para adotar.
