---
impacto: nada_mudou
secao: corrigido
titulo: Mudar o horário do agente vale também para quem já estava esperando
---

Quando uma mensagem chegava fora do horário de funcionamento do agente, a resposta
ficava agendada para a abertura do horário. Se você mudasse o horário e publicasse
uma nova versão, essa resposta continuava presa ao horário antigo. As mensagens que
o mesmo cliente mandava depois entravam na mesma espera.

Agora, ao publicar uma versão, as respostas adiadas pelo horário daquele número de
WhatsApp são reavaliadas na hora. Se o horário novo já está aberto, o agente
responde em seguida. Se ainda está fechado, a resposta continua esperando a
abertura.

Você não precisa fazer nada para adotar.
