# SERAPH

> o harness que voa

Agente de código para o terminal, no estilo do OpenCode. Conecte **qualquer API** compatível com
OpenAI, a Anthropic ou entre com o **GitHub Copilot**. Ele lê, edita arquivos e roda comandos na pasta
onde você abriu.

```text
                ▄▄▀▀▀▀▀▀▀▀▀▀▀▀▀▄▄
                ▀▄▄           ▄▄▀
                  ▀▀▀▀▀▀▀▀▀▀▀▀▀
                    ▄▄█████▄▄
               ▄▄    █▀ ▀ ▀█    ▄▄
             ▄▀▀▄ ▀▄▄ ▀█▄█▀ ▄▄▀ ▄▀▀▄
          █▄▄ ▀▄▄ ▀▄▄▄█████▄▄▄▀ ▄▄▀ ▄▄█
```

## Instalar

Precisa de Node 20 ou mais novo.

```bash
npm install
npm run build
node dist/cli.js            # abre na pasta atual
node dist/cli.js ../outro   # ou em outra pasta
```

Para ter o comando `seraph` em qualquer lugar: `npm link`.

## Conectar uma API

Dentro do SERAPH, digite `/connect` e escolha:

| Opção | O que fazer |
| --- | --- |
| **GitHub Copilot** | Aparece um código; abra o endereço mostrado e digite o código. Sem chave. |
| OpenAI, Anthropic, OpenRouter, Groq, DeepSeek, Gemini | Cole a chave. |
| Ollama, LM Studio | Nada a colar: são servidores locais. |
| **Outra API compatível com OpenAI** | Informe a URL (`https://…/v1`) e, se houver, a chave. |

Depois, `/models` para escolher o modelo.

Também dá para usar variáveis de ambiente, que têm prioridade sobre a chave salva:
`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`, `GROQ_API_KEY`, `DEEPSEEK_API_KEY`,
`GEMINI_API_KEY`.

## Atalhos

| Tecla | Ação |
| --- | --- |
| `tab` | alterna **Construir** (edita e roda) e **Planejar** (só lê) |
| `ctrl+p` | paleta de comandos |
| `esc` | interrompe o agente |
| `ctrl+c` | limpa o campo; duas vezes para sair |

Comandos: `/connect` `/models` `/sessions` `/new` `/themes` `/thinking` `/compact` `/export`
`/disconnect` `/help` `/exit`.

## Segurança

- Chaves e a sessão do Copilot ficam em `~/.seraph`, **criptografadas** com o usuário do Windows (DPAPI);
  em outros sistemas, com permissão `0600`. Nada disso entra no repositório.
- No modo **Construir**, escrever, editar e rodar comandos **pedem sua aprovação** (`s` sim, `a` sempre
  para aquela ferramenta, `n` não). Leitura nunca pede.
- No modo **Planejar**, as ferramentas que alteram algo nem são oferecidas ao modelo.
- Todo caminho é preso à pasta de trabalho: `../` e caminhos absolutos fora dela são recusados.
- Se existir um `AGENTS.md` na pasta, o SERAPH o lê como regras do projeto.

## Desenvolvimento

```bash
npm run typecheck   # tsc --noEmit
npm test            # testes (rede simulada e um servidor HTTP local de verdade)
npm run build       # compila src/ para dist/
```

Os testes usam uma pasta temporária (`SERAPH_HOME`) e nunca tocam em `~/.seraph`.

## Licença

MIT
