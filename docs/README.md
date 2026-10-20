# Omnis — documentação

```
docs/
  adr/    # decisões de arquitetura (fonte da verdade)
  tasks/  # specs de implementação para o Cursor (backlog em tasks/README.md)
  ops/    # checklists manuais de infraestrutura (não são tarefas do Cursor)
```

## Fluxo

1. **ADR**: decisão discutida e aceita.
2. **Task**: spec escrita a partir dos ADRs e aprovada antes de ir para o Cursor.
3. **Cursor implementa** e preenche o "Registro de implementação" da task.
4. **Revisão**: diff + critérios de aceite. Status atualizado no backlog.

Uma task nunca altera um ADR. Se a implementação mostrar que uma decisão estava errada, a discussão volta para um ADR novo ou uma emenda.

## Como rodar uma task no Cursor

1. Um chat novo (modo Agent) por task.
2. Prompt padrão:

```
Implemente a task docs/tasks/<ARQUIVO>.md.

Antes de começar, leia:
- docs/adr/0001-arquitetura-base.md
- docs/adr/0002-monorepo-e-shared.md
- .cursor/rules/

Implemente somente o escopo da task.
Se algo estiver ambíguo ou conflitar com os ADRs, pare e pergunte em vez de decidir sozinho.
Ao terminar, rode os comandos da seção "Verificação" e preencha o "Registro de implementação".
```

3. Revise o diff contra os critérios de aceite antes de commitar.
4. Atualize o status em `tasks/README.md`.
