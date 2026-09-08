# Design: POC Nginx — Proxy Reverso na Oracle Cloud

**Data:** 2026-09-07
**Status:** aprovado, pronto para plano de implementação

## Objetivo

Aprender Nginx em profundidade, usando a exposição de uma API simples para a
internet como caso de uso prático. O aprendizado é o produto; a API é apenas o
veículo.

## Contexto

- **Ponto de partida:** iniciante em DevOps. Sem conhecimento prévio de HTTPS,
  TLS, proxy reverso ou Nginx.
- **Ambiente alvo:** Oracle Cloud Always Free, shape `VM.Standard.E2.1.Micro`
  (1 OCPU / 1 GB RAM), Ubuntu Server. **A instância ainda não existe** — o
  provisionamento faz parte do escopo.
- **Máquina de desenvolvimento:** Windows 11.
- **Estado da VM:** vazia. Nenhum outro projeto roda nela. Não há Traefik,
  Prometheus, Grafana nem k6 instalados, e portanto não há disputa pela porta
  80.
- **Motivação:** entender manualmente, com Nginx, o que um proxy reverso com
  auto-discovery resolve automaticamente.

## Modo de trabalho: guiado, com configuração anotada

O usuário digita todo o código e executa todos os comandos. Claude entrega o
conteúdo pronto — `nginx.conf`, `Dockerfile`, código NestJS, comandos de
firewall — **anotado linha a linha**, com a seção da documentação oficial que
justifica cada uma.

Formato de toda entrega de configuração:

1. o arquivo ou comando completo, pronto para uso;
2. logo abaixo, uma explicação por linha ou por bloco;
3. o link direto da seção da documentação oficial que define aquela diretiva.

Nenhuma linha entra sem justificativa e sem fonte. Se uma diretiva não está na
documentação oficial, isso é dito explicitamente no próprio arquivo.

**Ressalva de procedência.** Nginx e OCI têm documentação oficial com exemplos
de configuração e comandos, citáveis seção por seção. O NestJS não publica
Dockerfile oficial: o Dockerfile desta POC é composto a partir do guia de
multi-stage build do Docker, e o arquivo da apostila marca isso como derivado,
não como transcrição.

Ao fim de cada fase, Claude questiona as escolhas de configuração. Digitar um
arquivo correto sem saber o que cada linha faz é o resultado que esta POC
existe para evitar; a anotação e a arguição são o que separa uma coisa da
outra.

## Estratégia: um suspeito por vez

O plano original validava o proxy reverso com `curl localhost` e só depois
abria o firewall. Nessa ordem, a primeira tentativa de acesso externo tem
quatro causas possíveis de falha simultâneas: Security List da OCI, iptables do
Ubuntu, `listen` do Nginx e container fora do ar.

Este design inverte: o firewall é aberto e validado **enquanto o Nginx ainda
serve conteúdo estático**. Quando o acesso externo falha nesse ponto, o único
suspeito é rede. Quando o `proxy_pass` falha depois, rede já foi provada e o
único suspeito é a configuração de proxy.

O `index.html` estático não é descartável: ele é o item "Serving Static
Content" do Beginner's Guide, promovido também a validador de rede. Uma etapa,
dois usos.

## Fases

### Fase 0 — Provisionamento OCI

Criar VCN e subnet pública, gerar par de chaves SSH, criar a instância
`VM.Standard.E2.1.Micro` com Ubuntu Server, primeiro acesso SSH, habilitar 2 GB
de swap, instalar Docker e git.

**Checkpoint:**
- `ssh ubuntu@<ip>` abre shell na VM
- `docker run hello-world` conclui com sucesso
- `free -h` mostra 2 GB de swap ativo

### Fase 1 — API NestJS em container

Criar projeto Nest no Windows com dois endpoints (`/health` e `/info`),
escrever Dockerfile multi-stage, publicar no GitHub, clonar na VM e buildar
lá.

**Checkpoint:** na VM, `curl localhost:8080/health` responde JSON.

### Fase 2A — Nginx servindo estático, com rede aberta

Instalar Nginx no host (sem container). Estudar diretivas simples versus
diretivas de bloco e os contextos `main`, `http`, `server`, `location`. Criar
um `server` block servindo um `index.html`. Abrir a porta 80 na Security List
da OCI e no iptables da VM.

**Checkpoint:** do Windows, `curl http://<ip-público>` retorna o HTML.
**Rede provada.**

### Fase 2B — Proxy reverso

Substituir o `root` estático por `proxy_pass` para `127.0.0.1:8080`.
Adicionar `proxy_set_header` para `Host`, `X-Real-IP` e `X-Forwarded-For`.

**Checkpoint:** do Windows, `curl http://<ip-público>/health` retorna o JSON da
API, e `docker logs` mostra o IP público do Windows como origem — não
`127.0.0.1`.

## Artefatos

Repositório único, iniciado em `oracle-test` e publicado no GitHub. A VM clona
esse repositório.

```
oracle-test/
├── docs/
│   ├── superpowers/specs/2026-09-07-poc-nginx-design.md
│   └── apostila/
│       ├── 00-provisionamento-oci.md
│       ├── 01-api-nestjs-docker.md
│       ├── 02a-nginx-estatico-e-rede.md
│       └── 02b-proxy-reverso.md
├── api/                    # escrito pelo usuário
│   ├── src/
│   ├── Dockerfile
│   └── package.json
└── nginx/
    └── poc-api.conf        # escrito pelo usuário
```

A apostila é escrita antes do início da execução, para consulta offline. Cada
arquivo segue a mesma estrutura:

1. **Conceito** — o que é e por que existe
2. **Referência oficial** — link direto para a seção
3. **Configuração anotada** — o arquivo ou comando pronto, com explicação linha
   a linha e a fonte oficial de cada diretiva
4. **Como validar** — comando exato e saída esperada
5. **Armadilhas** — o que costuma dar errado

`nginx/poc-api.conf` é uma cópia versionada do arquivo que vive em
`/etc/nginx/sites-available/` na VM. A cópia é manual. Não há automação de
deploy: automatizar esconderia justamente o que se quer aprender.

## Decisões técnicas e armadilhas

### Container publicado apenas no loopback

O container roda com `-p 127.0.0.1:8080:8080`, nunca `-p 8080:8080`.

O Docker publica portas escrevendo regras na tabela `nat` do iptables, e essas
regras são avaliadas antes da chain `INPUT`. Regras de firewall na `INPUT` não
filtram tráfego de container publicado. Com `-p 8080:8080`, a porta 8080 fica
acessível pela internet assim que a Security List permitir — sem passar pelo
Nginx e sem intenção explícita. Prender no loopback deixa a API alcançável
apenas pelo próprio host, que é o que o Nginx precisa.

### NestJS precisa escutar em `0.0.0.0`

`app.listen(8080)` liga no `localhost` do container e é inalcançável de fora
dele. O correto é `app.listen(8080, '0.0.0.0')`. O sintoma — `curl` falhando na
VM — aparenta ser problema de Docker.

### iptables no Ubuntu da Oracle: risco de perda de acesso

Um erro nesta etapa derruba a conexão SSH permanentemente. A instância continua
rodando, mas fica inacessível; a recuperação exige console serial da OCI ou
recriar a instância.

A imagem Ubuntu da Oracle já vem com regras de iptables, e a chain `INPUT`
termina com uma regra `REJECT` que descarta tudo que não foi aceito antes.
Consequências:

- A regra da porta 80 precisa ser **inserida antes** da linha `REJECT`.
  `iptables -A INPUT` insere depois dela e não tem efeito algum: a porta parece
  aberta na configuração e permanece fechada no comportamento.
- A regra que libera a porta 22 não pode ser alterada, removida nem reordenada
  para depois do `REJECT`.
- Fazer backup antes de qualquer alteração: `sudo iptables-save > ~/iptables.backup`.
- Manter a sessão SSH atual aberta durante todo o passo e testar o acesso em uma
  segunda sessão. Se a nova conexão falhar, a sessão original ainda permite
  restaurar o backup.
- A Oracle recomenda explicitamente não usar `ufw` nessas imagens: ele reescreve
  o conjunto de regras inteiro, e é assim que o acesso SSH costuma ser perdido.
- A regra não persiste após reboot; precisa ser salva com `netfilter-persistent`.

### Swap antes do primeiro build

`npm install` seguido de `nest build` em 1 GB sem swap termina com o processo
morto pelo OOM killer, e a mensagem resultante aparenta ser erro do npm. 2 GB de
swap em arquivo, criados na Fase 0, antes do primeiro build.

### Site default do Nginx ocupa a porta 80

O pacote do Ubuntu habilita um site default escutando na porta 80, que entra em
conflito com o novo `server` block. Desabilitar removendo o symlink em
`sites-enabled`.

`sites-available` e `sites-enabled` são convenção de empacotamento do
Debian/Ubuntu, não do Nginx upstream. A documentação do nginx.org não menciona
essas pastas — divergência que confunde quem segue os dois materiais em
paralelo.

## Validação

### Técnica

| Fase | Onde roda | Comando | Esperado |
|---|---|---|---|
| 0 | Windows | `ssh ubuntu@<ip>` | shell da VM |
| 0 | VM | `docker run hello-world` | mensagem de sucesso |
| 0 | VM | `free -h` | linha Swap com 2 GB |
| 1 | VM | `curl localhost:8080/health` | JSON da API |
| 2A | VM | `curl localhost` | HTML estático |
| 2A | **Windows** | `curl http://<ip>` | HTML estático |
| 2B | VM | `curl localhost/health` | JSON da API |
| 2B | **Windows** | `curl http://<ip>/health` | JSON da API |

As linhas rodadas do Windows são as que provam rede. `curl localhost` na VM
passa mesmo com o firewall inteiramente fechado.

Validação adicional na Fase 2B: `docker logs` da API deve registrar o IP
público do Windows como origem. Se registrar `127.0.0.1`, o
`proxy_set_header X-Real-IP` não está surtindo efeito — o proxy funciona, mas a
API perdeu a informação de quem chamou.

### De aprendizado

Nenhuma fase fecha apenas com o comando passando. Ao fim de cada uma, Claude
questiona as escolhas da configuração que o usuário acabou de aplicar: por que
aquele `location`, o que muda sem `proxy_set_header Host`, qual a diferença
entre `nginx -s reload` e `nginx -s quit`, o que aconteceria com `-A` no lugar
de `-I`.

Como a configuração é entregue pronta, esta é a única barreira contra o
copiar-e-colar. Ela não é opcional: uma fase só fecha quando o comando passa
**e** o usuário explica o que digitou.

## Fora de escopo

> **Nota posterior (2026-09-08).** Esta spec descreve a POC como foi planejada e
> executada. Depois do checkpoint da Tarefa 7, os itens de TLS e domínio saíram
> desta lista e foram implementados como itens 1 e 2 do
> [backlog](../../backlog.md). O registro está em
> [`passo-a-passo.md`](../../passo-a-passo.md). O restante desta seção continua
> valendo.

- TLS/HTTPS e Let's Encrypt — o conceito é explicado na apostila; a
  implementação fica para depois *(feito no backlog item 2)*
- Rate limiting (`limit_req_zone`) e fail2ban — spec separada, escrita após o
  checkpoint da Fase 2B
- Load balancing entre múltiplas instâncias
- Automação de deploy: CI/CD, unit do systemd, restart policy do Docker
- Domínio próprio e DNS — o acesso é por IP público direto *(feito no backlog
  item 1, com um subdomínio DuckDNS)*

## Referências oficiais

- Nginx Beginner's Guide — https://nginx.org/en/docs/beginners_guide.html
- Module ngx_http_proxy_module — https://nginx.org/en/docs/http/ngx_http_proxy_module.html
- Configuring HTTPS servers — http://nginx.org/en/docs/http/configuring_https_servers.html
- OCI — Security Lists — https://docs.oracle.com/en-us/iaas/Content/Network/Concepts/securitylists.htm
- OCI — Best Practices for Your Compute Instances — https://docs.oracle.com/en-us/iaas/Content/Compute/References/bestpracticescompute.htm

## Aprendizado esperado

Ao final: um proxy reverso configurado manualmente e compreendido linha a
linha, entendimento das duas camadas de firewall envolvidas em expor qualquer
serviço na Oracle Cloud, e base para comparar configuração manual (Nginx) com
auto-discovery por labels (Traefik) em projetos futuros.
