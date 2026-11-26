# Clara

Finanças pessoais para duas pessoas, com uso principal pelo navegador do iPhone, valores em reais e mês de referência de São Paulo. A primeira versão ajuda a entender onde o dinheiro está indo, por meio de importações mensais e análises por categoria, estabelecimento e mês.

## Escopo da primeira versão

- Entradas, despesas, saldo consolidado, compras parceladas e análise mensal. O mês atual é o ponto de partida; outros meses aparecem conforme os arquivos importados.
- Cada pessoa entra com sua própria conta ChatGPT e importa seus próprios arquivos. Seus lançamentos pessoais ficam privados.
- O resumo pessoal inclui tudo que a própria pessoa pagou, inclusive despesas marcadas para o casal. A área do casal reúne os lançamentos que cada pessoa compartilhou manualmente, sem calcular reembolsos ou acertos e sem acrescentá-los novamente ao total pessoal.
- Contas bancárias, cartões de crédito e vale alimentação são fontes separadas. O vale participa dos totais e continua identificável pela origem, com recargas e gastos registrados.
- Importação de vários arquivos em um lote, extração e sugestão de categorias, prévia com período, quantidades, totais e possíveis duplicatas, seguida de confirmação. As pendências podem ser corrigidas; o compartilhamento com o casal é uma escolha posterior.
- Ao corrigir uma categoria, você pode ensinar uma regra para as próximas compras do mesmo estabelecimento. Categorias próprias são aceitas; as regras ficam em Contas e saldos e podem ser removidas. Não alteram automaticamente o compartilhamento com o casal.

Investimentos com cotações ou rentabilidade, conexão direta com bancos, Atalhos do iPhone e registro individual de cada compra ficam fora desta versão.

## Relatórios, orçamentos e calendário

**Relatórios** reúne gastos líquidos por estabelecimento, número de compras, ticket médio e comparação com o mês anterior. É possível buscar um estabelecimento, filtrar categorias, ordenar o ranking e abrir os lançamentos que compõem cada valor. Há visões de todos os próprios gastos, somente pessoais e compartilhados do casal, além da comparação mensal por categoria.

**Orçamentos** permite definir um limite por categoria e mês, acompanhar realizado, disponível e valor ultrapassado, editar/remover limites e copiar categorias ausentes do mês anterior sem sobrescrever os limites atuais. O orçamento pessoal considera apenas lançamentos não compartilhados. O orçamento do casal considera os compartilhados dos dois; os dois membros podem editar seus limites comuns.

**Calendário** organiza receitas, despesas e pagamentos de fatura recorrentes, pessoais ou compartilhados, com repetição semanal, mensal ou anual. Datas mensais como dia 31 usam o último dia dos meses mais curtos; recorrências anuais de 29 de fevereiro usam 28 de fevereiro quando necessário. É possível definir data final, pausar e retomar uma recorrência.

Compromissos são previsões. Confirmar pagamento/recebimento ou ignorar um vencimento altera somente o calendário, sem criar uma receita/despesa nem mexer no saldo. Vincular um lançamento utiliza um movimento já importado; um movimento só pode estar vinculado a uma ocorrência. Se uma importação for removida, a referência apagada deixa o compromisso novamente a conferir. Pagamentos de fatura aparecem separados das demais despesas para evitar somar duas vezes a compra e a quitação no planejamento.

A indicação de vencimento passado não significa confirmação de atraso: sem nova importação, o pagamento precisa ser conferido ou informado manualmente. Pausar uma recorrência mantém confirmações anteriores; remover o planejamento não apaga lançamentos importados. Planejamentos pessoais continuam privados e os conjuntos seguem o vínculo atual do casal.

No celular, Início, Relatórios, Importar e Orçamentos ficam na barra inferior. **Mais** dá acesso a Lançamentos, Calendário, Metas e caixinhas, Nosso espaço e Contas e saldos.

## Metas e caixinhas

Crie metas pessoais ou do casal com nome, valor desejado e prazo opcional. Cada caixinha mostra o valor reservado, o que falta, o progresso e uma sugestão de aporte mensal calculada a partir do prazo. A sugestão divide o restante pelos meses de calendário, incluindo o mês atual e o mês do prazo; depois do prazo, mostra o restante como pendente. Essa área acompanha o histórico completo, independentemente do mês selecionado nas outras seções.

Aportes e resgates são registros manuais de uma reserva virtual: não fazem transferências, não criam lançamentos financeiros e não alteram os saldos das contas. O valor registrado deve corresponder ao dinheiro que você já separou; o Clara não verifica se ele está disponível no banco. O saldo consolidado também inclui benefícios, que têm restrições de uso, por isso ele não é apresentado como dinheiro livre para reservar ou investir.

Cada movimento guarda data, valor, observação opcional e quem o registrou. Um resgate não pode ultrapassar o valor reservado; tentativas repetidas do mesmo registro não duplicam o aporte. O histórico é preservado: para corrigir um valor registrado, faça um movimento inverso e registre o correto. Metas sem movimentos podem ser excluídas. Metas com histórico podem ser arquivadas e reativadas; reservas arquivadas continuam no total reservado e permitem resgates, mas exigem reativação antes de novos aportes.

As metas pessoais são privadas. Os dois integrantes do vínculo atual podem editar as metas do casal e registrar contribuições, sem acessar metas pessoais do parceiro. Esses registros são planejamento, sem cálculo de dívidas ou reembolso entre os dois. O modo demonstração inclui metas e contribuições fictícias e mantém as alterações somente na memória do navegador.

## Importação e limites dos formatos

CSV e OFX são lidos como dados estruturados. PDF com texto passa por extração no navegador. Imagens e capturas de tela podem passar por OCR no navegador, útil para o histórico do Sólides Benefícios quando não houver exportação. Várias capturas do mesmo período podem ser selecionadas juntas.

O OCR não usa um serviço de reconhecimento na nuvem. O navegador precisa baixar o mecanismo e os arquivos de idioma, o que pode exigir conexão e demorar na primeira leitura. Reconhecimento de texto e identificação de colunas podem errar; confira valores, datas, direção dos movimentos e parcelas na prévia. A confirmação envia os lançamentos normalizados para a API; o fluxo de extração acontece no navegador.

A existência de um formato exportado pela instituição não garante que todos os seus layouts sejam reconhecidos. Sicredi, Mercado Pago, PicPay, Nubank e Sólides precisam ser validados com arquivos reais de cada conta. CSV, OFX, PDF e imagens têm leitura inicial implementada, sujeita a essa validação. CNAB ainda não é suportado.

[public/modelo-importacao.csv](public/modelo-importacao.csv) é um exemplo sintético, sem dados pessoais. Usa as colunas `data,descricao,valor,tipo,categoria`, datas `AAAA-MM-DD`, ponto decimal e valores de saída negativos. Contém Pix, salário, recarga de benefício, parcela e pagamento de fatura. O mesmo conteúdo em [fixtures/sample.csv](fixtures/sample.csv) serve aos testes. Uma importação associa cada arquivo à sua fonte; reimportar o mesmo conteúdo na mesma fonte deve preservar os lançamentos existentes.

## Fontes, saldo e parcelas

Uma fonte representa uma conta, um cartão ou um benefício. Quando o arquivo não traz um saldo utilizável, informe uma vez o saldo de referência da fonte e sua data. Esse valor representa o saldo antes dos movimentos da data informada; o cálculo acrescenta os movimentos a partir dessa data, inclusive, até o fim do mês consultado. Um saldo de fechamento extraído do arquivo é convertido para uma referência no dia seguinte. Se a referência coincide com o primeiro dia do mês seguinte, ela já informa o fechamento do mês consultado, sem somar novamente os movimentos anteriores. Antes do ponto conhecido o saldo fica indisponível; sem saldo inicial conhecido, o resultado com os movimentos disponíveis é indicado como incompleto ou estimado.

O saldo consolidado soma contas bancárias e benefícios. Cartões de crédito ficam fora desse saldo. Entradas, estornos e transferências recebidas aumentam o saldo da fonte; despesas, transferências enviadas e pagamentos de fatura o reduzem. Transferências e pagamentos de fatura não são novas receitas ou despesas na análise de consumo. Por exemplo, a compra de R$ 200 no cartão é uma despesa; quando a fatura é paga pela conta, o pagamento reduz o saldo bancário sem contar R$ 200 de despesa novamente.

Uma compra de R$ 600 em três parcelas aparece como R$ 200 em cada mês da fatura. O detalhe guarda a parcela atual e o total. A previsão das próximas parcelas é calculada a partir dos lançamentos importados e evita contar outra vez uma parcela real já importada. Não é uma nova despesa confirmada.

## Autenticação, privacidade e casal

Em desenvolvimento local, a integração Sites oferece uma identidade fictícia única ao abrir `/signin-with-chatgpt?return_to=/`. Esse mock só funciona em loopback (`localhost`, `127.0.0.1` ou `::1`); não representa duas contas reais. Sair usa `/signout-with-chatgpt?return_to=/`. A API exige uma sessão autenticada.

Na publicação, a plataforma Sites conduz o login ChatGPT e fornece a identidade autenticada ao servidor. O mock local não faz parte desse fluxo. O identificador da conta é a chave de propriedade das fontes, importações e lançamentos; nome e email são dados de exibição.

O vínculo do casal usa um código que a própria pessoa compartilha com o parceiro. Só os lançamentos marcados manualmente ficam disponíveis na área conjunta. O código não dá acesso aos demais dados pessoais nem libera acesso ao site no hosting.

Um novo Site é privado por padrão. Para o parceiro usá-lo, o proprietário precisa liberar o acesso dessa conta nas configurações de acesso do hosting, além do vínculo de casal dentro do aplicativo. O aplicativo não envia convites por email; o código do casal é compartilhado por você.

## Desenvolvimento

Requer Node compatível com [package.json](package.json). O projeto usa Vinext/React, um Worker Cloudflare e D1 para persistência. O binding lógico `DB` está em [.openai/hosting.json](.openai/hosting.json); o schema está em [db/schema.ts](db/schema.ts).

Com as dependências instaladas, os comandos locais são:

```powershell
npm run dev
npm run typecheck
npm test
npm run build
```

`npm run dev` inicia o preview de desenvolvimento na porta 5173. `npm run build` gera o Worker em `dist/server`; `npm start` executa esse build localmente via Wrangler, com o estado em `.wrangler/state`, e não simula o login ChatGPT. Use o preview de desenvolvimento para os testes que dependem do mock de login.

Quando o schema mudar, gere as migrações com `npm run db:generate` e revise o SQL em `drizzle/`. Depois de um build, aplique cada migração pendente ao D1 local, substituindo `NOME_DA_MIGRACAO.sql` pelo arquivo real:

```powershell
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/NOME_DA_MIGRACAO.sql
```

Não reaplique arquivos já executados. O banco local e o hospedado são separados; a publicação pelo fluxo Sites aplica as migrações hospedadas. Os helpers da skill Sites preparam dependências, build, pacote de fonte e publicação; não altere o `project_id` ao atualizar o mesmo Site.

## Verificação

`npm test` executa os testes de cálculo, importação, validação e banco SQLite sem navegador. `npm run typecheck` verifica os tipos.

Os testes em [tests/e2e/app.spec.ts](tests/e2e/app.spec.ts) usam Playwright. Inicie o preview e aplique as migrações antes de rodá-los; a configuração não inicia servidor automaticamente:

```powershell
npm exec playwright test
```

`CLARA_TEST_BASE_URL` altera a origem de teste, cujo padrão é `http://localhost:5173`. No Windows, o Chromium usa o Chrome em `C:/Program Files/Google/Chrome/Application/chrome.exe`; `CLARA_CHROME_EXECUTABLE_PATH` permite apontar para outro executável.

Use um D1 local de desenvolvimento, sem dados pessoais e sem vínculo de casal preexistente, para os testes de API. Eles criam uma fonte e uma importação sintéticas, e um vínculo de casal temporário. Ao terminar, removem as importações e saem do vínculo que criaram; a fonte sintética vazia permanece, pois a API não oferece exclusão de fontes. Os checks cobrem acesso anônimo, login local, deduplicação, edição e compartilhamento, além de navegação em desktop e celular. O mock único não comprova sozinho o isolamento entre duas identidades reais; esse limite deve ser considerado ao validar o acesso de duas contas na plataforma.
