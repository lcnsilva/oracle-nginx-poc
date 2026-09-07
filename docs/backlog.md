# Backlog — ideias para as próximas sprints

Itens levantados durante a execução da POC, fora do escopo da spec atual.
Cada um vira spec e plano próprios quando for a vez.

---

## 1. `server_name` explícito e `location` alinhado à rota do container

**Levantado em:** Tarefa 5, ao escrever o `server` block estático.

### Como está hoje

```nginx
server {
    listen 80 default_server;
    server_name _;

    location / {
        proxy_pass http://127.0.0.1:8080;
    }
}
```

Duas escolhas deliberadamente frouxas, porque a POC acessa por IP e serve uma
única aplicação:

- **`server_name _`** — `_` é um nome que nunca casa com host real. Combinado
  com `default_server`, significa "atendo qualquer `Host` que chegar". O Nginx
  nem chega a comparar nomes: só existe um `server` block.
- **`location /`** — casa com todos os caminhos. Tudo que entra é encaminhado
  para o container, sem distinção.

### O que mudaria

**`server_name` com domínio real.** Com um domínio apontando para o IP, o
`server_name` passa a selecionar de fato: o Nginx compara o header `Host` da
requisição contra os `server_name` de cada bloco e escolhe um. Isso é o que
permite hospedar vários sites no mesmo IP e na mesma porta — *virtual hosting*.
Também é pré-requisito para TLS: certificado é emitido para um nome, não para
um endereço IP.

**`location` alinhado à rota da API.** Hoje o container responde em `/health` e
`/info` na raiz. A ideia é dar à API um prefixo próprio — `setGlobalPrefix('api')`
no NestJS — e espelhar isso no Nginx:

```nginx
location /api/ {
    proxy_pass http://127.0.0.1:8080/api/;
}

location / {
    root /var/www/poc-api;
}
```

Ganhos: a raiz volta a servir conteúdo estático (uma landing, um front-end), e
a API fica isolada num prefixo. Dá para adicionar rate limiting só em `/api/`,
log separado, timeouts diferentes.

### O detalhe que exige atenção

É exatamente aqui que a barra final do `proxy_pass` deixa de ser irrelevante:

| `proxy_pass` | Requisição `/api/health` chega no container como |
|---|---|
| `http://127.0.0.1:8080` (sem caminho) | `/api/health` — URI repassado inteiro |
| `http://127.0.0.1:8080/` (com caminho) | `/health` — o prefixo do `location` é substituído |

Com `location /`, os dois se comportam igual, e é por isso que a POC atual não
percebe a diferença. Com um prefixo, escolher errado quebra todas as rotas.

Referência: https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_pass

### Dependências

Um domínio próprio. O que também destrava o item 2.

---

## 2. TLS/HTTPS com Let's Encrypt

Já registrado como fora de escopo na spec da POC. Depende de domínio próprio —
não se emite certificado para IP. Uma vez feito o item 1, este é o passo
natural: `server_name` real, certificado, redirecionamento de 80 para 443, e o
header `X-Forwarded-Proto` passando a fazer sentido.

Referência: https://nginx.org/en/docs/http/configuring_https_servers.html

---

## 3. Fase 3 da spec original — rate limiting e fail2ban

Previsto desde o plano original, com spec e plano próprios após o checkpoint da
Tarefa 7:

- rate limiting nativo do Nginx (`limit_req_zone` + `limit_req`)
- validação sob carga com k6
- fail2ban lendo o access log do Nginx, com jail customizado
- teste de cenário de abuso e banimento automático

Duas camadas reagindo de formas diferentes: uma nativa no proxy, outra externa
por análise de log.
