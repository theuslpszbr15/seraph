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
npm link                    # cria o comando `seraph`
seraph                      # abre na pasta atual, em tela cheia
seraph ../outro             # ou em outra pasta
seraph -c                   # retoma a última conversa desta pasta
seraph -s <id>              # retoma uma conversa específica
```

O SERAPH abre em tela cheia (como o OpenCode) e, ao sair, devolve o terminal como estava, com o
comando para continuar a conversa. No PowerShell com scripts bloqueados, apague
`%APPDATA%\npm\seraph.ps1`: o `seraph.cmd` funciona sem mudar a política.

## Conectar uma API

Dentro do SERAPH, digite `/connect` e escolha:

| Opção | O que fazer |
| --- | --- |
| **GitHub Copilot** | Aparece um código; abra o endereço mostrado e digite o código. Sem chave. |
| OpenAI, Anthropic, OpenRouter, Groq, NVIDIA, DeepSeek, Gemini | Cole a chave. |
| Ollama, LM Studio | Nada a colar: são servidores locais. |
| **Outra API compatível com OpenAI** | Informe a URL (`https://…/v1`) e, se houver, a chave. |

Depois, `/models` para escolher o modelo.

Também dá para usar variáveis de ambiente, que têm prioridade sobre a chave salva:
`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`, `GROQ_API_KEY`, `NVIDIA_API_KEY`, `DEEPSEEK_API_KEY`,
`GEMINI_API_KEY`.

## Atalhos

| Tecla | Ação |
| --- | --- |
| `enter` / `ctrl+j` | envia / nova linha. Durante uma resposta, a mensagem entra na fila |
| `ctrl+v` | cola (texto com várias linhas fica no campo, não é enviado) |
| `tab` | alterna **Construir** (edita e roda) e **Planejar** (só lê); completa `/comando` e `@arquivo` |
| `ctrl+p` | paleta de comandos |
| `↑` `↓` | mensagens anteriores |
| `PgUp` `PgDn`, roda do mouse | rola a conversa; `End` volta ao fim |
| `esc` | interrompe o agente |
| `ctrl+c` | limpa o campo; vazio, sai. Ou clique em **✕ sair** no rodapé |
| `shift`+arrastar | seleciona texto para copiar (o mouse rola a conversa) |

No campo de mensagem:

- `@caminho` anexa um arquivo do projeto (com sugestões enquanto digita);
- `!comando` roda direto no terminal e a saída entra no contexto da conversa.

Comandos: `/connect` `/models` `/sessions` `/new` `/undo` `/init` `/auto` `/themes` `/thinking`
`/details` `/compact` `/export` `/copy` `/disconnect` `/help` `/exit`.

- `/copy` copia a última resposta para a área de transferência.

- `/undo` desfaz a última resposta **e** devolve os arquivos que ela mudou ao estado anterior.
- `/init` pede ao agente um `AGENTS.md` para o projeto.
- `/auto` aprova tudo sem perguntar (também dá para apertar `A` no pedido de aprovação).
- Quando o contexto passa de 80% da janela do modelo, a conversa é resumida sozinha.

Em janelas com 110 colunas ou mais aparece a barra lateral: título, contexto usado, modelo, modo e
arquivos alterados.

## Temas

`/themes` mostra a prévia ao vivo enquanto você navega. O padrão segue as cores do OpenCode; há ainda
Tokyo Night, Catppuccin, Dracula, Gruvbox, Nord, One Dark, Celestial, 16 paletas próprias e
"Fundo do terminal", que mantém a cor de fundo do seu terminal.

Tema próprio: crie `~/.seraph/themes/meu.json` com qualquer uma das chaves `bg`, `panel`, `element`,
`border`, `text`, `muted`, `primary`, `secondary`, `accent`, `ok`, `warn`, `bad` (cores `#rrggbb`).

## Comandos próprios

Cada `.md` em `~/.seraph/commands/` ou `<projeto>/.seraph/commands/` vira um comando:

```markdown
---
description: revisa um arquivo
---
Revise $1 procurando bugs. Contexto extra: $ARGUMENTS
```

Salvo como `revisar.md`, use `/revisar src/app.ts`.

## Segurança

- Chaves e a sessão do Copilot ficam em `~/.seraph`, **criptografadas** com o usuário do Windows (DPAPI);
  em outros sistemas, com permissão `0600`. Nada disso entra no repositório.
- No modo **Construir**, escrever, editar e rodar comandos **pedem sua aprovação** (`s` sim, `a` sempre
  para aquela ferramenta, `A` aprovar tudo, `n` não). Leitura nunca pede.
- No modo **Planejar**, as ferramentas que alteram algo nem são oferecidas ao modelo.
- Chaves coladas perdem espaços e quebras de linha, e o SERAPH avisa quando o formato não bate com o
  provedor (ex.: NVIDIA começa com `nvapi-`).
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
