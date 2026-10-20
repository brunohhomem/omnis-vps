# Checklist — Migração do DNS para a Cloudflare

Pré-requisito do Cloudflare Tunnel (ADR-001, D9). Manual, fora do Cursor. Pode ser feito em paralelo ao desenvolvimento, já que a propagação leva horas.

O **registro do domínio continua na Hostinger**. Só a gestão do DNS muda para a Cloudflare (plano gratuito).

## Antes

1. [ ] Na Hostinger, aba **DNSSEC**: se estiver ativo, **desativar** e aguardar. Trocar nameservers com DNSSEC ativo derruba a resolução do domínio.
2. [ ] Exportar ou fotografar a lista atual de registros DNS.

## Na Cloudflare

3. [ ] Criar conta gratuita e adicionar o domínio (plano Free).
4. [ ] Conferir **um a um** os registros importados automaticamente:

| Tipo | Nome | Valor | Proxy |
|---|---|---|---|
| A | `@` | IP da VPS | **DNS only** (nuvem cinza) |
| A | `www` | IP da VPS | **DNS only** |
| A | `api` | IP da VPS | **DNS only** |
| TXT | `resend._domainkey` | chave DKIM completa | — |
| MX | `send` | `feedback-smtp.sa-east-1.amazonses.com` (prioridade 10) | — |
| TXT | `send` | `v=spf1 include:amazonses.com ~all` | — |
| TXT | `_dmarc` | `v=DMARC1; p=none;` | — |

   - O DKIM é longo: comparar o valor inteiro com o da Hostinger.
   - **DNS only** mantém o Nginx e o Let's Encrypt funcionando exatamente como hoje. Ligar o proxy (nuvem laranja) é outra decisão.
5. [ ] Anotar os dois nameservers que a Cloudflare indicar.

## Troca

6. [ ] Na Hostinger: **Alterar nameservers** → nameservers da Cloudflare. Fazer num horário de pouco uso.
7. [ ] Aguardar a Cloudflare marcar o domínio como **Active** (minutos a algumas horas).

## Depois

8. [ ] `dig +short <dominio>` e `dig +short api.<dominio>` retornam o IP da VPS.
9. [ ] Site e API respondendo com HTTPS válido.
10. [ ] Enviar um e-mail de teste pelo sistema (Resend) e conferir que chegou fora do spam.
11. [ ] No painel do Resend, o domínio continua verificado.

A partir daqui, alterações de DNS são feitas **na Cloudflare**. O painel de DNS da Hostinger deixa de ter efeito.
