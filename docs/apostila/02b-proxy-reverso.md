# 02b — Proxy reverso: `proxy_pass` e headers de encaminhamento

> Corresponde à **Tarefa 7** do plano de implementação.
> Pré-requisito: Tarefa 6 concluída — o `index.html` estático já acessível pelo
> IP público. **Rede provada.**

A partir daqui, qualquer falha de acesso externo é problema de configuração do
Nginx. Isso não é uma suposição: foi construído pelas tarefas anteriores, e é
o que torna esta etapa depurável.

---

## 1. Conceito

### 1.1 O que muda quando o Nginx deixa de servir disco

Até agora o `server` block lia um arquivo do sistema de arquivos e devolvia. O
proxy reverso substitui essa origem: em vez de ler do disco, o Nginx **abre uma
nova conexão HTTP** com a aplicação, repassa a requisição, recebe a resposta e
a devolve ao cliente.

São duas conexões distintas, não uma só encaminhada:

```
cliente  ──conexão 1──▶  Nginx  ──conexão 2──▶  container
         ◀─────────────         ◀─────────────
```

Essa separação é a origem de tudo que vem a seguir. A conexão 2 é criada pelo
Nginx, com os dados que **o Nginx** decidir colocar nela. Nada da conexão 1
atravessa automaticamente.

### 1.2 `proxy_pass`

A diretiva que define o destino da conexão 2. Vai dentro de um `location`, e
recebe o endereço da aplicação — nesta POC, `127.0.0.1:8080`, o loopback onde o
container foi publicado.

O destino ser loopback é o que fecha o desenho de segurança: a API não tem
porta pública, e o único caminho até ela passa pelo Nginx.

**A barra final muda o comportamento.** Este é o detalhe da diretiva que mais
gera confusão, e vale ler na documentação em vez de decorar uma regra:

- Quando o endereço em `proxy_pass` termina com um caminho (inclusive apenas
  `/`), o prefixo casado pelo `location` é **substituído** por esse caminho.
- Quando o endereço não tem caminho nenhum, o URI da requisição é repassado
  **inteiro**, como veio.

Numa POC em que o `location` é `/`, os dois parecem equivalentes. Deixam de ser
no momento em que aparece um `location /api/`. Vale testar a diferença.

Referência: https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_pass

### 1.3 O que se perde no caminho, e por quê

Na conexão 2, quem faz a requisição é o Nginx. Do ponto de vista da aplicação:

- **O cliente é o Nginx.** O IP de origem que a API enxerga é `127.0.0.1`. Todo
  o tráfego do mundo chega aparentando vir do loopback.
- **O header `Host` é o do destino do proxy**, não o que o usuário digitou.

Consequências concretas: log de acesso inútil (todos os registros com o mesmo
IP), rate limiting por IP impossível, bloqueio por origem impossível, e
qualquer URL que a aplicação gere para si mesma sai apontando para o endereço
errado.

Nada disso quebra a resposta. A API responde certo, o `curl` funciona, e a
informação some em silêncio. **É uma falha que só aparece quando você vai
procurar por ela** — motivo pelo qual a Tarefa 7 pede explicitamente que você
olhe o `docker logs` antes de configurar os headers.

### 1.4 `proxy_set_header`

A diretiva que reconstrói, na conexão 2, a informação que existia na conexão 1.
Três headers importam nesta POC.

**`Host`** — repassa o host que o cliente pediu originalmente. Sem ele, a
aplicação acha que foi chamada em `127.0.0.1:8080`. Isso quebra
redirecionamentos, links absolutos, cookies com domínio e qualquer roteamento
por nome de host.

**`X-Real-IP`** — carrega o IP do cliente, num valor único e direto. É o mais
simples de consumir: um endereço, sem ambiguidade.

**`X-Forwarded-For`** — carrega a **cadeia** de proxies pela qual a requisição
passou, como uma lista separada por vírgulas. Existe porque, na vida real,
pode haver mais de um proxy no caminho (CDN, balanceador, e só então o seu
Nginx). Cada um acrescenta o endereço que enxergou.

**Por que os dois existem.** `X-Real-IP` é uma convenção do Nginx, simples e
sem histórico. `X-Forwarded-For` é o padrão de fato da indústria e preserva o
caminho inteiro. Numa cadeia com vários proxies, `X-Real-IP` sobrescrito por
cada salto perde a informação anterior; o `X-Forwarded-For` acumula.

E é exatamente aí que mora a armadilha da configuração: se você preencher
`X-Forwarded-For` com o IP do cliente direto, o valor é **substituído** a cada
salto e o header deixa de ser uma cadeia — vira uma cópia pior do `X-Real-IP`.
O Nginx tem uma variável específica que resolve isso, anexando ao que já
existia em vez de sobrescrever. Encontrá-la faz parte do exercício.

Ponto de partida — a lista de variáveis embutidas:
https://nginx.org/en/docs/http/ngx_http_core_module.html#variables

Diretiva:
https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_set_header

### 1.5 Uma nota de segurança sobre esses headers

Headers são texto enviado pelo cliente. Um cliente malicioso pode mandar o
próprio `X-Forwarded-For` inventado. Uma aplicação que confia cegamente nesse
valor pode ser enganada sobre a origem da requisição.

A defesa é confiar no header apenas quando ele vem de um proxy que você
controla, e reescrever o que vem de fora. Nesta POC o Nginx sempre define os
três headers, o que já sobrescreve o que o cliente tenha mandado. Configurações
mais elaboradas (`real_ip_header`, `set_real_ip_from`) ficam fora de escopo,
mas vale saber que a questão existe antes de usar `X-Forwarded-For` para
decisão de segurança em produção.

---

## 2. Referências oficiais

- **Setting Up a Simple Proxy Server** — https://nginx.org/en/docs/beginners_guide.html#proxy
- **Módulo `ngx_http_proxy_module`** — https://nginx.org/en/docs/http/ngx_http_proxy_module.html
- **`proxy_pass`** — https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_pass
- **`proxy_set_header`** — https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_set_header
- **Variáveis embutidas** — https://nginx.org/en/docs/http/ngx_http_core_module.html#variables

---

## 3. Exercício

1. Registrar o estado "antes": chamar `/health` pelo IP público e receber 404
   do Nginx. O caminho não existe como arquivo estático — o Nginx responde,
   mas não sabe encaminhar.
2. Editar o `server` block: tirar as diretivas de conteúdo estático e
   encaminhar para `127.0.0.1:8080`.
3. `nginx -t` e recarregar.
4. Validar de dentro da VM (`curl localhost/health`) e de fora
   (`curl.exe http://<ip>/health`).
5. **Antes de configurar os headers**, olhar o `docker logs` e observar todas
   as requisições registradas como vindas de `127.0.0.1`. Ver o problema antes
   de aprender a diretiva que o resolve.
6. Acrescentar `proxy_set_header` para `Host`, `X-Real-IP` e
   `X-Forwarded-For` — este último com a variável que **acumula** a cadeia, não
   com o IP direto do cliente.
7. Recarregar, gerar tráfego novo do Windows e conferir o `docker logs` de
   novo.
8. Atualizar `nginx/poc-api.conf` no repositório e commitar.

---

## 4. Como validar

Na VM:

```bash
curl localhost/health
```

Esperado: o JSON da API, agora atravessando o Nginx na porta 80.

No Windows:

```bash
curl.exe http://<ip-publico>/health
curl.exe http://<ip-publico>/info
```

Esperado: os dois JSONs definidos na Tarefa 3. **Objetivo da POC cumprido.**

Na VM, depois dos headers:

```bash
docker logs poc-api --tail 5
```

Esperado: o IP público da sua conexão no Windows.
Se ainda aparecer `127.0.0.1`, os headers não estão sendo aplicados — e o
`curl` continua funcionando normalmente, que é justamente o que torna essa
falha fácil de não perceber.

---

## 5. Armadilhas

**Barra final no `proxy_pass`.**
Muda o caminho que chega na aplicação. Com `location /` a diferença some; com
qualquer prefixo, não. Cause a diferença de propósito uma vez para ver.

**Esquecer os `proxy_set_header`.**
Não quebra nada visível. A API responde, os testes passam, e a informação de
origem se perde. É a falha silenciosa desta etapa.

**Preencher `X-Forwarded-For` com o IP do cliente direto.**
O header deixa de acumular e passa a ser sobrescrito a cada salto — perde
exatamente a propriedade que justifica sua existência.

**Deixar as diretivas de conteúdo estático junto do `proxy_pass`.**
Configuração ambígua no mesmo `location`. Ao substituir o comportamento,
remova o que ficou para trás.

**Testar o `docker logs` sem gerar tráfego novo.**
As linhas antigas continuam mostrando `127.0.0.1` — foram geradas antes da
mudança. Faça uma requisição nova depois do reload e olhe só o final do log.

**Reload sem `nginx -t`.**
Vale para toda edição, não só as anteriores.

---

## Checkpoint final da POC

Todos verdadeiros ao mesmo tempo:

- [ ] `curl.exe http://<ip-publico>/health` no Windows retorna o JSON da API
- [ ] `curl.exe http://<ip-publico>/info` no Windows retorna o JSON da API
- [ ] `sudo ss -tlnp | grep 8080` mostra `127.0.0.1:8080`, nunca `0.0.0.0:8080`
- [ ] `docker logs poc-api` registra o IP público real do cliente
- [ ] Depois de `sudo reboot`, tudo acima continua verdadeiro sem intervenção
- [ ] `nginx/poc-api.conf` no repositório é idêntico ao arquivo em uso na VM

Cumprido isso, a Fase 3 da spec original — rate limiting com `limit_req_zone` e
fail2ban — ganha spec e plano próprios.

---

**Anterior:** [`02a-nginx-estatico-e-rede.md`](02a-nginx-estatico-e-rede.md)
