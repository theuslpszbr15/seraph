# SERAPH - Estado local

## 2026-10-06

- Corrigido o layout de conversas longas: o historico nao empurra mais o campo de mensagem para fora da tela.
- Testes cobrem campo visivel, digitacao e envio na fila enquanto o agente responde com historico longo.
- Corrigido clique em sair: eventos de clique nao sao mais consumidos como rolagem de zero linhas.
- Teste confirma que clicar em sair encerra a interface e clicar fora nao encerra.
- Typecheck passou; 72/72 testes passaram com FORCE_COLOR=0 (cores ANSI interferem em duas comparacoes visuais existentes).
- Build passou; dist atualizado. A instancia ja aberta precisa ser reiniciada para receber a correcao.
- Verificado por testes: modo de selecao nativa Ctrl+S /select, tela congelada durante selecao e Esc para restaurar mouse. Selecao com mouse fisico no Windows Terminal ainda nao verificada.
- Verificado com HTTP local: 429 com Retry-After, pausa por provedor e fila preservada sem tentativas imediatas. A cota externa nao e removida pelo SERAPH.
- Alteracoes locais, ainda nao publicadas. Projeto da empresa nao foi alterado.

## 2026-10-07

- Anjo detalhado em Braille Unicode: 96 colunas x 26 linhas, grade de 192 x 104 pontos, seis asas com penas, rosto, aureola e manto.
- Versao detalhada automatica em terminais com pelo menos 98 colunas e 50 linhas; arte compacta preservada nas janelas menores.
- Typecheck e build passaram; 75/75 testes passaram, incluindo dimensoes, redimensionamento e prompt visivel. Dist atualizado.
- Desenho gerado conferido na saida do terminal; aparencia com fonte do terminal do usuario ainda nao verificada.
- GitHub ainda nao recebeu as alteracoes locais desta sessao.

## Entrega Atual

- A pedido do usuario, anjo removido da abertura; somente o nome SERAPH permanece. Gerador Braille descartado.
- Correcao de layout, clique em sair, selecao nativa e tratamento de 429 incluidos na mesma entrega.
- Verificacao completa passou: typecheck, 74/74 testes com FORCE_COLOR=0 e build. Dist atualizado com abertura sem anjo.
- Commit e push para theuslpszbr15/seraph autorizados pelo usuario. Projeto da empresa permanece isolado.