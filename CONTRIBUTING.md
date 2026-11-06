# Como contribuir com o BSR Hub

Leia primeiro o [Processo de desenvolvimento, QC e produção](docs/operations/TEAM_WORKFLOW_QC.md).

## Regras rápidas

1. Trabalhe em branch própria baseada em develop.
2. Uma Issue deve descrever a tarefa e os critérios de aceite.
3. Não envie commits diretamente para main ou develop.
4. Abra Pull Request para develop e preencha o modelo.
5. Execute os testes aplicáveis antes de solicitar revisão.
6. O QC revisa, testa e registra o resultado.
7. Não aprove seu próprio Pull Request.
8. Não inclua config.js, .env, credenciais, tokens ou dados reais.
9. O QC pode corrigir somente ajustes pequenos e localizados; mudanças maiores voltam ao desenvolvedor.
10. Somente o proprietário autoriza integração em main e publicação oficial.

## Testes básicos

    npm ci
    npm run test:security
    npm run test:ratings
    npm run test:content
    npm run test:stewarding
    npm run test:telemetry

Em caso de dúvida, abra uma Issue ou peça orientação ao QC antes de modificar áreas sensíveis.
