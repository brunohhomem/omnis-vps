# T005 — Adaptadores e modo fake

- **Fase:** 2a — Fundação do backend
- **Depende de:** T003
- **ADRs:** 001 (D6), 002 (M11)

## Objetivo

Criar a camada `infra/`, único lugar do código que toca o sistema operacional, com implementações `real` (Linux) e `fake` (qualquer SO, testes). Esta task entrega os dois primeiros adaptadores: **leitura do sistema** e **execução de comandos**.

## Escopo

### 1. Estrutura

```
apps/server/src/infra/
  index.ts                      # createAdapters(config) → Adapters
  system/
    system.adapter.ts           # interface SystemAdapter
    system.linux.ts             # implementação real (/proc + statfs)
    system.fake.ts              # implementação fake
    proc-parsers.ts             # funções puras de parsing
  exec/
    command-runner.ts           # interface + implementação real
    command-runner.fake.ts
    commands.ts                 # registro fechado de comandos
apps/server/test/infra/
  fixtures/                     # conteúdos de /proc de exemplo
  proc-parsers.test.ts
  system.fake.test.ts
  command-runner.test.ts
```

### 2. Shared: `system/metrics.schemas.ts`

`SystemSnapshotSchema`:

```ts
{
  ts: IsoDateTime,
  cpu: { usagePct: number },
  load: { m1: number, m5: number, m15: number },
  mem: { totalBytes, availableBytes, usedPct, swapTotalBytes, swapUsedBytes },
  disks: Array<{ mount: string, totalBytes, freeBytes, usedPct }>,
  net: Array<{ iface: string, rxBytesPerSec, txBytesPerSec }>,
  uptimeSec: number
}
```

### 3. `SystemAdapter`

```ts
interface SystemAdapter {
  readSnapshot(): Promise<SystemSnapshot>;
}
```

**Implementação Linux (`system.linux.ts`)**, sem dependências externas:

| Dado | Fonte | Observação |
|---|---|---|
| CPU % | `/proc/stat` | Delta entre leituras. Na primeira leitura, amostra de 500 ms |
| Load | `/proc/loadavg` | |
| Memória | `/proc/meminfo` | Usar `MemAvailable` (não `MemFree`) |
| Disco | `fs.statfs` | Pontos de montagem de `DISK_MOUNTS` |
| Rede | `/proc/net/dev` | Delta por segundo · ignorar `lo` e interfaces `veth*`, `br-*`, `docker*` |
| Uptime | `/proc/uptime` | |

O parsing fica em `proc-parsers.ts` como **funções puras** (string → objeto), testadas com fixtures.

**Implementação fake (`system.fake.ts`):**

- Valores plausíveis para uma VPS de 2 vCPU / 8 GB / 100 GB.
- **Padrão diário**: base + curva por hora do dia com pico entre 20h e 22h e vale de madrugada, mais ruído pequeno. Assim o relatório de picos (T010) tem algo a mostrar no dev.
- Disco crescendo lentamente.
- Aceita `seed` e um relógio injetável para testes determinísticos.

### 4. `CommandRunner`

```ts
type CommandDef<A extends z.ZodTypeAny> = {
  key: string;            // ex.: 'system.uptime'
  bin: string;            // caminho absoluto, ex.: '/usr/bin/uptime'
  args: A;                // schema zod dos argumentos
  buildArgv: (args: z.infer<A>) => string[];
  timeoutMs: number;
  sudo?: boolean;         // usado a partir da T020, após decisão de sudoers
};

interface CommandRunner {
  run(key: string, args: unknown): Promise<{ stdout: string; stderr: string; exitCode: number; durationMs: number }>;
}
```

Regras da implementação real:

1. Só executa comandos presentes no registro `commands.ts`. Chave desconhecida → `AppError('ADAPTER_UNAVAILABLE')`.
2. Valida `args` com o schema do comando antes de montar o `argv`.
3. Usa `execFile` (via `node:child_process`, promisificado). **Nunca** `exec` nem `shell: true`.
4. `timeout` e `maxBuffer` (1 MB) obrigatórios.
5. Loga chave, exit code e duração. Não loga `argv` nem saída.
6. Recebe a função de spawn por injeção, para os testes verificarem que é `execFile`.

Registro inicial em `commands.ts`: só `system.uptime` → `/usr/bin/uptime`, sem argumentos (comando inofensivo para provar o fluxo). Novos comandos entram nas tasks dos módulos.

**Fake:** retorna saídas pré-configuradas por chave e registra as chamadas recebidas (para os testes conferirem).

### 5. `createAdapters(config)`

1. `OMNIS_MODE=fake` → implementações fake.
2. `OMNIS_MODE=real` em SO diferente de Linux → erro claro no boot: "OMNIS_MODE=real exige Linux; use OMNIS_MODE=fake no desenvolvimento".
3. `AppDeps` ganha `adapters: { system: SystemAdapter; exec: CommandRunner }`.

### 6. Config nova

| Variável | Default |
|---|---|
| `DISK_MOUNTS` | `/` (lista separada por vírgula) |

### 7. Rota

`GET /api/system/snapshot` no módulo `system` → `SystemSnapshotSchema`. Adicionar ao `system.service.ts` o método `getSnapshot()`, que chama `deps.adapters.system.readSnapshot()`. A rota chama o service, nunca o adaptador direto.

### 8. Testes

- `proc-parsers`: fixtures reais de `/proc/stat`, `/proc/meminfo`, `/proc/net/dev` e `/proc/loadavg`, incluindo o cálculo de delta de CPU.
- Fake: com relógio fixo em 21h, o CPU médio é maior do que às 4h; mesmo `seed` gera a mesma sequência.
- `CommandRunner`: chave desconhecida rejeitada; argumentos inválidos rejeitados; a função injetada é chamada sem shell; timeout respeitado.

## Verificação

1. Em qualquer SO, com `OMNIS_MODE=fake`: `curl /api/system/snapshot` retorna dados válidos.
2. Em Linux (WSL serve) com `OMNIS_MODE=real`: os valores batem aproximadamente com `free -b`, `df -B1 /` e `cat /proc/loadavg`. Registrar a comparação.
3. `typecheck`, `lint` e `test` passam.

## Critérios de aceite

- [ ] Nenhum arquivo fora de `src/infra/` lê `/proc` ou importa `node:child_process`.
- [ ] Nenhuma dependência nova (sem `systeminformation`).
- [ ] Fake com padrão diário determinístico.

## Fora de escopo

Adaptadores de PM2, Docker e journald (entram nas tasks dos módulos, seguindo este padrão). Persistência de métricas (T010).

## Registro de implementação

- Comparação real × `free`/`df` (se testado em Linux):
- Desvios da spec e motivo:
- Problemas encontrados:
