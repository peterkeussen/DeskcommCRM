/**
 * O que a instalação já trouxe — e o que o produto NÃO pode fingir que sabe.
 *
 * Este leitor existe para o onboarding parar de perguntar o que o instalador já
 * perguntou. Errar para o lado otimista aqui é caro: dizer "chave configurada"
 * quando não há chave produz a frase mais perigosa do produto — a que tranquiliza
 * enquanto o funcionário está mudo.
 */
import { describe, expect, it } from "vitest";

import {
  lerAmbiente,
  nomeAindaEhPlaceholder,
  NOME_PLACEHOLDER_DA_INSTALACAO,
} from "@/lib/instalacao/ambiente";

describe("lerAmbiente", () => {
  it("enxerga a chave de cada provedor que TEM chave de plataforma", () => {
    const a = lerAmbiente({
      ANTHROPIC_API_KEY: "sk-ant-x",
      OPENAI_API_KEY: "sk-proj-x",
      OPENROUTER_API_KEY: "sk-or-x",
    });
    expect(a.chavesDeProvedor.anthropic).toBe(true);
    expect(a.chavesDeProvedor.openai).toBe(true);
    expect(a.chavesDeProvedor.openrouter).toBe(true);
  });

  it("o Google conta como configurado só pela variável que o runtime lê", () => {
    // `resolveOrgLlmConfig` tem o ramo `provider === 'google'` lendo
    // GEMINI_API_KEY. Um nome parecido que o runtime NÃO lê não pode acender a
    // tela — seria prometer um caminho que o turno recusa.
    expect(lerAmbiente({ GOOGLE_API_KEY: "qualquer-coisa" }).chavesDeProvedor.google).toBe(false);
    expect(lerAmbiente({ GEMINI_API_KEY: "AIza-x" }).chavesDeProvedor.google).toBe(true);
  });

  it("variável VAZIA é ausente — é o contrato do .env do projeto", () => {
    // O template gera `CHAVE=` e o README promete "deixe vazio e cadastre
    // depois". Tratar isso como configurado inverteria a promessa.
    const a = lerAmbiente({ ANTHROPIC_API_KEY: "", OPENROUTER_API_KEY: "   " });
    expect(a.chavesDeProvedor.anthropic).toBe(false);
    expect(a.chavesDeProvedor.openrouter).toBe(false);
  });

  it("ambiente vazio não inventa nada", () => {
    const a = lerAmbiente({});
    expect(Object.values(a.chavesDeProvedor).some(Boolean)).toBe(false);
    expect(a.gateway).toBe(false);
    expect(a.email).toBe(false);
    expect(a.transporteDeWhatsapp).toEqual({ apontado: false, comChave: false });
  });

  // O caso do placeholder mudou de arquivo: ele precisa nomear as VARIÁVEIS do
  // transporte, e esse nome só pode viver dentro de `lib/channels/` — ver
  // `lib/channels/transporte.test.ts`.

  it("e-mail configurado é o que decide se o convite sai de verdade", () => {
    // Falso em toda instalação pelo kit hoje: o `install.sh` não coleta essa
    // chave. É por isso que o passo de convites precisa tratar o link manual
    // como caminho NORMAL, e não como exceção.
    expect(lerAmbiente({}).email).toBe(false);
    expect(lerAmbiente({ RESEND_API_KEY: "re_x" }).email).toBe(true);
  });
});

describe("nomeAindaEhPlaceholder", () => {
  it("reconhece a organização que o instalador batizou", () => {
    // O `install.sh` nunca pergunta o nome do negócio: toda instalação nasce
    // "Minha Empresa", e esse texto aparece no cabeçalho do wizard.
    expect(nomeAindaEhPlaceholder({ slug: "minha-empresa", display_name: "Qualquer" })).toBe(true);
    expect(nomeAindaEhPlaceholder({ slug: "outro", display_name: NOME_PLACEHOLDER_DA_INSTALACAO })).toBe(
      true,
    );
  });

  it("não acusa quem já deu um nome ao negócio", () => {
    expect(nomeAindaEhPlaceholder({ slug: "clinica-vida", display_name: "Clínica Vida" })).toBe(
      false,
    );
    expect(nomeAindaEhPlaceholder({ slug: null, display_name: null })).toBe(false);
  });
});
