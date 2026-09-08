# Passo a passo executado — POC Nginx

Registro do que foi **de fato** feito, com os valores reais do ambiente.

Diferente dos outros documentos do repositório:

| Documento | O que é |
|---|---|
| [`superpowers/specs/`](superpowers/specs/2026-09-07-poc-nginx-design.md) | o desenho: decisões e por quê |
| [`superpowers/plans/`](superpowers/plans/2026-09-07-poc-nginx.md) | o roteiro: tarefas e passos previstos |
| [`apostila/`](apostila/) | o material de estudo: conceito e configuração anotada |
| **este arquivo** | o diário: o que aconteceu, com os valores reais |

Última atualização: 2026-09-07.

---

## Estado atual

| Fase | Tarefa | Situação |
|---|---|---|
| — | 1 — Repositório e apostila | ✅ concluída |
| 0 | 2 — Provisionamento da VM na OCI | ✅ concluída |
| 1 | 3 — API NestJS local | ✅ concluída |
| 1 | 4 — Dockerfile e deploy na VM | ✅ concluída |
| 2A | 5 — Nginx servindo estático | ✅ concluída |
| 2A | 6 — Abrir a porta 80 nas duas camadas | ✅ concluída |
| 2B | 7 — Proxy reverso | ✅ concluída |
| pós-POC | Backlog 1 — `server_name` real e `location` com prefixo | ✅ concluída |
| pós-POC | Backlog 2 — TLS/HTTPS com Let's Encrypt | ✅ concluída |
| pós-POC | Backlog 3 — remover headers `Server` e `X-Powered-By` | ⬜ pendente |
| Fase 3 | Rate limiting + fail2ban | ⬜ spec própria |

**POC concluída**, e os dois primeiros itens de backlog também. O serviço está
em HTTPS, com certificado válido e renovação automática verificada.

**Próximo passo:** backlog item 3 (curto), depois a Fase 3 — rate limiting e
fail2ban — em spec e plano próprios.

Pendências menores anotadas:

- o log da API ainda não registra o `X-Forwarded-Proto`; exige uma linha em
  `api/src/main.ts` e um rebuild
- o `index.html` ainda diz "se você está lendo isto pelo IP público", o que
  deixou de valer quando o catch-all passou a responder `444`
- a persistência da regra de iptables da porta 443 não foi confirmada com um
  reboot

Documentos irmãos: [`backlog.md`](backlog.md) para o que ficou fora de escopo, e
[`perguntas-e-respostas.md`](perguntas-e-respostas.md) para as dúvidas que
surgiram durante a execução, com as respostas.

---

## Valores do ambiente

| Item | Valor |
|---|---|
| Região OCI | `sa-saopaulo-1` |
| Compartment | `lcnsilvajf` (root) |
| VCN | `nginx-vcn-poc` — `10.0.0.0/16` |
| Internet Gateway | `igw-poc` |
| Route table | Default Route Table da VCN, com rota `0.0.0.0/0 → igw-poc` |
| Subnet | `subnet-publica-poc` — `10.0.0.0/24`, Regional, Public |
| Instância | `poc-nginx` — `VM.Standard.E2.1.Micro`, Ubuntu |
| IP público | `129.159.50.172` |
| IP privado | `10.0.0.215` (interface `ens3`) |
| Domínio | `lcnsilva.duckdns.org` (DuckDNS, registro A para o IP público) |
| Certificado | Let's Encrypt, `/etc/letsencrypt/live/lcnsilva.duckdns.org/` |
| Portas abertas | 22 (SSH), 80 (redireciona para HTTPS), 443 (aplicação) |
| URL pública | `https://lcnsilva.duckdns.org/api/health` e `/api/info` |
| Chave SSH | `C:\Users\lucia\.ssh\oci-poc-nginx` |
| Node local | v24.13.0 / npm 11.6.2 |
| Swap na VM | 2 GB em `/swapfile` |

Comando de acesso:

```bash
ssh -i $env:USERPROFILE\.ssh\oci-poc-nginx ubuntu@129.159.50.172
```

---

## Tarefa 1 — Repositório e apostila ✅

1. `git init` na raiz de `oracle-test`.
2. `.gitignore` criado, excluindo `node_modules/`, `dist/`, `*.pem`, `*.key`,
   `id_rsa*` e os nomes da chave da OCI.
3. Spec, plano e os quatro arquivos da apostila escritos e commitados.
4. Repositório no GitHub: **ainda não criado**. Nada foi enviado (`push`
   pendente).

Para publicar, quando o repositório existir:

```bash
git remote add origin git@github.com:<usuario>/<repo>.git
git push -u origin main
```

---

## Tarefa 2 — Provisionamento da VM ✅

Material: [`apostila/00-provisionamento-oci.md`](apostila/00-provisionamento-oci.md)

### 2.1 Par de chaves SSH

```bash
ssh-keygen -t ed25519 -f $env:USERPROFILE\.ssh\oci-poc-nginx
```

Gerou `oci-poc-nginx` (privada) e `oci-poc-nginx.pub` (pública). A privada nunca
saiu da máquina e está coberta pelo `.gitignore`.

### 2.2 Rede — criada manualmente, não pelo assistente

O plano original previa o assistente *Create VCN with Internet Connectivity*. Na
execução foi usado o **Create VCN** simples, que cria apenas a VCN. As demais
peças foram montadas uma a uma — o que acabou sendo melhor para o objetivo da
POC, porque o assistente esconde exatamente essas peças.

Ordem executada:

1. **VCN** `nginx-vcn-poc`, CIDR `10.0.0.0/16`.
2. **Internet Gateway** `igw-poc`.
3. **Regra de rota** na Default Route Table: `0.0.0.0/0` → `igw-poc`.
4. **Subnet** `subnet-publica-poc`: Regional, `10.0.0.0/24`, Public Subnet,
   apontando para a route table editada e para a Default Security List.

Caminho resultante:

```
internet → Internet Gateway → Route Table (0.0.0.0/0) → Subnet pública → instância
```

### 2.3 Instância

**Compute → Instances → Create Instance**, com:

- Name `poc-nginx`
- Image: Canonical Ubuntu (trocada; o default era Oracle Linux)
- Shape `VM.Standard.E2.1.Micro`, aba AMD, marcado *Always Free eligible*
- Subnet `subnet-publica-poc`, com IP público atribuído
- Chave pública `oci-poc-nginx.pub` colada
- Seção *Security*: tudo desmarcado
- VNIC: campos em branco, sem network security groups

### 2.4 Primeiro acesso — houve um `Connection refused`

A primeira tentativa de SSH falhou:

```
ssh: connect to host 129.159.50.172 port 22: Connection refused
```

Causa: a instância aparece como `Running` assim que o hypervisor a liga, antes
de o Ubuntu terminar o boot e subir o `sshd`. Resolveu sozinho em cerca de um
minuto.

O erro foi útil: `Connection refused` significa que veio um TCP RST de volta —
o pacote fez o caminho de ida completo e a resposta fez o de volta. Isso provou
que rota, gateway, subnet e Security List na porta 22 estavam corretos. Um
`timeout` não teria provado nada disso.

Verificação sem tentar autenticar:

```powershell
Test-NetConnection 129.159.50.172 -Port 22
```

### 2.5 Confirmação do IP privado

```bash
ip addr show
```

Mostrou `10.0.0.215/24` em `ens3`, com MTU 9000 (jumbo frames, padrão da rede
interna da OCI). O IP público `129.159.50.172` **não aparece** dentro do Ubuntu —
é NAT feito pela OCI sobre o IP privado da VNIC. Comportamento correto.

### 2.6 Swap

Estado antes: `Swap: 0B`, com 954 MiB de RAM total.

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

Resultado confirmado por `free -h` (`Swap: 2.0Gi`) e `swapon --show`.

### 2.7 git, curl e Docker

```bash
sudo apt update
sudo apt install -y git curl
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu
```

Seguido de reconexão do SSH (o grupo novo só vale em sessão nova) e validação
com `docker run hello-world`, que rodou sem `sudo`.

### 2.8 Checkpoint da Tarefa 2

- [x] `ssh ubuntu@129.159.50.172` abre shell
- [x] `docker run hello-world` roda sem `sudo`
- [x] `free -h` mostra 2 GB de swap
- [x] Revisão conceitual feita (subnet pública x privada; `refused` x `timeout`)

---

## Tarefa 3 — API NestJS local ✅

Material: [`apostila/01-api-nestjs-docker.md`](apostila/01-api-nestjs-docker.md)

### Critério de aceitação definido antes do código

```
GET /health  →  {"status":"ok"}
GET /info    →  {"name":"poc-api","version":"1.0.0","uptime":<segundos>}
```

### Executado

1. **Critério escrito** antes de qualquer implementação (acima).
2. **Projeto criado** com `npx @nestjs/cli new api`, gerenciador npm.
3. **Falha observada antes da implementação:** `npm run start` +
   `curl.exe http://localhost:3000/health` retornando 404. Confirma que o
   servidor sobe e que o `curl.exe` funciona, antes de haver código a testar —
   separa "meu código está errado" de "meu comando está errado".
4. **`api/src/app.controller.ts`** escrito com os dois endpoints.
5. **`api/src/main.ts`** alterado para `await app.listen(8080, '0.0.0.0')`.
6. **Validado** na porta 8080.
7. **Commit** `33dd27f`.

Código anotado linha a linha em
[`apostila/01-api-nestjs-docker.md`](apostila/01-api-nestjs-docker.md),
seções 3.1 e 3.2.

### Saída da validação

```
curl.exe http://localhost:8080/health
{"status":"ok"}

curl.exe http://localhost:8080/info
{"name":"poc-api","version":"1.0.0","uptime":139}
```

Bate exatamente com o critério de aceitação.

### Desvio encontrado: repositório git aninhado

O `nest new` roda `git init` dentro de `api/`, criando um repositório aninhado.
O git da raiz recusa indexar esse diretório:

```
error: 'api/' does not have a commit checked out
```

O repositório aninhado tinha zero commits — nada a preservar. Resolvido com:

```powershell
Remove-Item -Recurse -Force api\.git
```

A partir daí `api/` passou a pertencer ao repositório principal, que é o que o
plano prevê: a VM clona um repositório só.

---

## Tarefa 4 — Dockerfile e deploy na VM ✅

Material: [`apostila/01-api-nestjs-docker.md`](apostila/01-api-nestjs-docker.md)

### Executado

1. **`api/.dockerignore`** e **`api/Dockerfile`** multi-stage escritos, com
   `node:24-alpine` nos dois estágios. Commit `7fff58e`.
2. **Repositório publicado** em https://github.com/lcnsilva/oracle-nginx-poc
3. **Clonado na VM** em `~/poc-nginx`.
4. **Estado "antes" registrado:** `curl localhost:8080/health` →
   `Connection refused`.
5. **Build na VM** com `docker build -t poc-api .` — concluído sem `Killed`,
   confirmando que o swap da Tarefa 2 cumpriu o papel.
6. **Container em execução:**
   `docker run -d --name poc-api --restart unless-stopped -p 127.0.0.1:8080:8080 poc-api`

### Checkpoint

- [x] `curl localhost:8080/health` → `{"status":"ok"}`
- [x] `sudo ss -tlnp | grep 8080` → `127.0.0.1:8080`, não `0.0.0.0:8080`
- [x] Revisão conceitual feita

Saída do `ss`:

```
LISTEN 0 4096   127.0.0.1:8080   0.0.0.0:*   users:(("docker-proxy",pid=3686,fd=8))
```

A primeira coluna é o **bind local** — é ela que importa. A segunda é o *peer*,
e o `0.0.0.0:*` ali significa "aceita de qualquer origem", não um bind aberto.
Quem segura o socket no host é o `docker-proxy`, não o Node — o processo Node
vive no namespace de rede do container.

### Por que `-p 127.0.0.1:8080:8080` e não `-p 8080:8080`

| Comando | Onde a porta aparece | Quem alcança |
|---|---|---|
| sem `-p` | só na bridge do Docker | outros containers; nem o host |
| `-p 127.0.0.1:8080:8080` | loopback do host | processos dentro da VM — o Nginx |
| `-p 8080:8080` | todas as interfaces do host | quem chegar por `ens3` (`10.0.0.215:8080`) |

Com `-p 8080:8080`, as duas camadas de firewall se comportariam de forma
diferente:

| Camada | Protegeria? |
|---|---|
| Security List (OCI) | sim — é externa à VM, o Docker não a alcança |
| iptables da VM | **não** — o Docker publica portas via DNAT em `PREROUTING`, e o tráfego segue por `FORWARD`, nunca pela chain `INPUT` |

Ou seja: a porta ficaria protegida por uma única camada, configurada num
console web, sem que nada dentro da máquina reclamasse. E o erro seria
invisível — tudo continuaria funcionando pelo Nginx, nenhum teste falharia.

Para filtrar tráfego de container com iptables existe a chain `DOCKER-USER`,
avaliada antes das regras geradas pelo Docker. Fora do escopo desta POC, que
resolve prendendo no loopback.

---

## Tarefa 5 — Nginx servindo estático ✅

Material: [`apostila/02a-nginx-estatico-e-rede.md`](apostila/02a-nginx-estatico-e-rede.md)

Nenhum firewall foi tocado nesta tarefa. Validação apenas local, de propósito.

### Executado

1. `sudo apt install -y nginx`. O `curl localhost` devolveu a página
   "Welcome to nginx!" — o site `default` do pacote, ocupando a porta 80.
2. `sudo rm /etc/nginx/sites-enabled/default` e `systemctl reload nginx`.
3. Página criada em `/var/www/poc-api/index.html`.
4. `server` block escrito em `/etc/nginx/sites-available/poc-api`.
5. Symlink criado em `sites-enabled`, `nginx -t` passou, reload aplicado.
6. `curl localhost` devolveu o HTML da POC.
7. Acesso externo testado e **falhou, como previsto**.

### Episódio de diagnóstico: "de onde vem essa configuração?"

O `rm` do site default acabou sendo executado duas vezes. A segunda devolveu:

```
rm: cannot remove '/etc/nginx/sites-enabled/default': No such file or directory
```

Como a primeira execução não tinha sido registrada, ficou a dúvida: o arquivo
nunca existiu, ou já havia sido removido? A hipótese inicial era de que esta
imagem usasse `conf.d/` em vez de `sites-enabled/` — o que teria invalidado a
apostila. **Era falso.** A convenção `sites-available`/`sites-enabled` está lá,
como descrito.

O que resolveu:

```bash
sudo nginx -T
```

`-T` maiúsculo testa **e imprime** a configuração efetiva, com todos os
`include` já resolvidos. A saída trazia apenas `nginx.conf` e `mime.types`:
nenhum `server` block carregado, nada escutando na porta 80. Nginx ativo e sem
nada para servir — estado legítimo, e exatamente o resultado esperado do
passo 2.

A confirmação veio dos timestamps:

```
/etc/nginx/conf.d/        Aug 19 16:57   ← nunca tocado
/etc/nginx/sites-enabled/ Sep  7 17:44   ← modificado hoje
```

O diretório fora alterado no mesmo dia: o symlink existia e foi removido pela
primeira execução do `rm`.

Duas ferramentas que ficam do episódio:

- `nginx -T` responde "de onde vem essa configuração", com os includes
  resolvidos e o arquivo de origem de cada linha
- `grep ':80'` casa também com `:8080`, por ser substring. Para filtrar porta
  de verdade: `ss -tlnp sport = :80`

### Checkpoint

- [x] `curl localhost` devolve o `index.html` da POC
- [x] Acesso externo falha — rede ainda fechada

Saída do acesso externo, do Windows:

```
curl.exe --max-time 10 http://129.159.50.172
curl: (28) Connection timed out after 10003 milliseconds
```

**Timeout**, como a previsão de `de8266a` antecipava para o estado "nenhuma das
duas camadas aberta": a Security List descarta o pacote em silêncio. A segunda
metade da previsão — a mensagem mudar para `No route to host` depois de abrir
só a Security List — será verificada na Tarefa 6.

---

## Tarefa 6 — Abrir a porta 80 nas duas camadas ✅

Material: [`apostila/02a-nginx-estatico-e-rede.md`](apostila/02a-nginx-estatico-e-rede.md)

Executada em duas partes: a camada 1 primeiro, reversível por um clique; a
camada 2 depois, com o protocolo de proteção completo.

### Parte 1 — Security List

Regra de Ingress adicionada: `CIDR`, `0.0.0.0/0`, `TCP`, Source Port `All`,
Destination Port `80`, stateful.

Caminho no console: **Networking → VCNs → `nginx-vcn-poc` → Subnets →
`subnet-publica-poc` → Security Lists**. O plano original mandava chegar pela
instância — útil apenas quando não se sabe qual subnet a instância usa.

**Depois da regra, o acesso externo continuou dando `timeout`, com a mesma
mensagem de antes.** Foi aqui que a previsão registrada em `de8266a` caiu.

### O diagnóstico que resolveu

Duas evidências, na VM.

**Como o iptables nega:**

```
5    REJECT  0  --  0.0.0.0/0  0.0.0.0/0  reject-with icmp-host-prohibited
```

`REJECT`, não `DROP`. Em tese responde com erro ICMP.

**Se o pacote chega**, com `sudo tcpdump -ni ens3 tcp port 80` rodando durante
a requisição:

```
177.16.235.121.64798 > 10.0.0.215.80: Flags [S], seq 1825709202
177.16.235.121.64798 > 10.0.0.215.80: Flags [S], seq 1825709202
177.16.235.121.64798 > 10.0.0.215.80: Flags [S], seq 1825709202
```

O SYN chegando e sendo retransmitido três vezes — nenhuma resposta voltou.
Prova de que a Security List estava aberta e o bloqueio era interno.

Conclusão: o `REJECT` responde, mas o ICMP não sobrevive ao caminho de volta.
As duas camadas produzem o mesmo `timeout`. **`tcpdump` é o que distingue**, não
a mensagem de erro — porque não depende de o ICMP chegar.

### Parte 2 — iptables

Protocolo seguido na íntegra: backup com `iptables-save`, segunda sessão SSH
mantida aberta, inserção da regra, teste de acesso numa terceira sessão antes
de qualquer outra verificação.

```bash
sudo iptables -I INPUT 5 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo netfilter-persistent save
```

Ordem resultante — a regra do SSH permanece intocada na posição 4:

```
4    ACCEPT  6  --  state NEW tcp dpt:22
5    ACCEPT  6  --  state NEW tcp dpt:80
6    REJECT  0  --  reject-with icmp-host-prohibited
```

### Checkpoint

- [x] `curl.exe http://129.159.50.172` do Windows devolve o `index.html`
- [x] Regra do SSH preservada
- [x] Após `sudo reboot`, tudo volta sozinho

Estado pós-reboot, sem nenhuma intervenção:

```
5    ACCEPT  6  --  state NEW tcp dpt:80          ← netfilter-persistent
poc-api   Up 36 seconds   127.0.0.1:8080->8080/tcp ← --restart unless-stopped
curl localhost:8080/health → {"status":"ok"}
curl localhost             → index.html            ← serviço do Nginx no boot
```

Cada um volta por um mecanismo diferente, configurado em uma tarefa diferente.

---

## Tarefa 7 — Proxy reverso ✅

Material: [`apostila/02b-proxy-reverso.md`](apostila/02b-proxy-reverso.md)

### Preparação: log de requisição

O plano previa observar em `docker logs` que a API vê todos os clientes como
`127.0.0.1`. **Isso não funcionaria:** o NestJS não registra requisições por
padrão, só as linhas de bootstrap. Foi preciso adicionar um middleware em
`api/src/main.ts` registrando método, caminho, `socket.remoteAddress` e os dois
headers de encaminhamento.

Os parâmetros exigiram tipagem explícita (`Request`, `Response`, `NextFunction`
do `express`) por causa do modo estrito do TypeScript. O parâmetro não usado
recebeu prefixo `_`, mas não pode ser omitido: o Express identifica middleware
comum pela **quantidade** de parâmetros.

### Baseline, antes de qualquer proxy

```
GET /health | socket=172.17.0.1 | x-real-ip=- | x-forwarded-for=-
```

`172.17.0.1`, não `127.0.0.1` como o material previa. É o gateway da bridge
`docker0` — o lado do host na rede do container:

```
curl (VM) ──> 127.0.0.1:8080 ──> docker-proxy ──> 172.17.0.2:8080 (container)
              └─ conexão 1 ─┘                 └─ conexão 2 ─┘
```

O `docker-proxy` não repassa a conexão original: abre uma nova, saindo pela
bridge. Já havia um proxy no caminho antes do Nginx entrar — e com dois saltos,
o endereço do socket **nunca** revela o cliente real. Header é a única via.

### Versão 1 — proxy sem headers

`root`, `index` e `try_files` removidos; `proxy_pass http://127.0.0.1:8080`
no lugar. Resposta confirmando a cadeia inteira:

```
HTTP/1.1 200 OK
Server: nginx/1.24.0 (Ubuntu)     ← quem respondeu
X-Powered-By: Express             ← quem gerou o conteúdo
Content-Type: application/json    ← veio da API, não do disco
```

Acesso externo funcionando, e a perda de informação visível no log — cinco
requisições, duas delas vindas da internet, todas registradas como
`172.17.0.1` com os headers vazios.

### Episódio: o 404 que não devia existir

Logo após o primeiro `reload`, `curl localhost/health` devolveu o 404 do Nginx
— o comportamento da configuração **estática**, não da nova.

`nginx -t` havia passado, e isso não significa nada aqui: a configuração antiga
é sintaticamente perfeita. `nginx -t` pega erro de digitação, não "a mudança
não foi aplicada".

O que respondeu foi `nginx -T`, comparando o arquivo em disco com a
configuração efetivamente carregada — as duas já tinham o `proxy_pass`. O
`curl` havia corrido junto com o reload. Repetido, retornou 200.

É exatamente a falha silenciosa documentada em `b21ec7f`: nada reclama, e o
comportamento é o antigo.

Verificação barata que passou a ser usada depois de cada reload:

```bash
sudo nginx -T | grep -c proxy_set_header
```

### Versão 2 — com os headers

```nginx
proxy_set_header Host            $host;
proxy_set_header X-Real-IP       $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
```

Resultado, com tráfego novo vindo do Windows:

```
GET /health | socket=172.17.0.1 | x-real-ip=177.16.235.121 | x-forwarded-for=177.16.235.121
```

O `socket` continua sendo o `docker-proxy`, e continuaria mesmo com tudo
perfeito. O que mudou é a API **saber** quem chamou, porque o Nginx contou.

### A internet encontrou a VM em menos de uma hora

Entre as linhas do log, uma que ninguém pediu:

```
GET /api/config.json | socket=172.17.0.1 | x-real-ip=- | x-forwarded-for=-
```

Sonda de scanner automatizado procurando arquivo de configuração exposto. Os
headers vazios datam a requisição: chegou antes do reload da versão 2, ou seja,
menos de uma hora depois de a porta 80 ser aberta.

Argumento concreto para a Fase 3 — rate limiting e fail2ban.

---

## Correções feitas no material durante a execução

O material foi escrito antes da execução e mudou por causa dela. Registro do
que mudou e por quê:

| Commit | Mudança | Motivo |
|---|---|---|
| `b7693bf` | modo de trabalho: de exercício sem gabarito para configuração pronta e anotada | pedido do usuário: entregar o "como", desde que ancorado na documentação oficial |
| `b7693bf` | removido o passo que pedia ao usuário validar se a apostila ensinava bem | avaliação impossível para quem ainda não conhece o assunto |
| `8a27d82` | apostila 00 reescrita para o caminho manual de criação da rede, com os campos de CIDR | o assistente não foi usado, e o caminho manual expõe as peças que a POC quer ensinar |
| `8a27d82` | documentados `Connection refused` x `timeout`, seção *Security* e VNIC do formulário, e o IP público invisível dentro do Ubuntu | dúvidas e erros reais encontrados na execução |
| `de8266a` | previsão de que o sintoma mudaria de `timeout` para `No route to host` ao abrir só a Security List | a Security List descarta em silêncio e o iptables da imagem nega com `REJECT`, que responde |
| `ba1ab65` | **previsão revertida** — o sintoma não muda | verificado na Tarefa 6: o ICMP do `REJECT` é filtrado no retorno e o cliente continua vendo `timeout`. A afirmação original da apostila estava certa; `de8266a` corrigiu um acerto. `tcpdump` passou a ser documentado como a evidência confiável |
| `b21ec7f` | reload com configuração inválida **não** derruba o serviço | o mestre rejeita a config nova e segue com a antiga; o risco real é a mudança não ser aplicada em silêncio. Quem cai é `systemctl restart` |
| `5675e2f` | `Dockerfile` de `node:22-alpine` para `node:24-alpine` | alinhar com o Node v24 instalado na máquina de desenvolvimento |
| — | documentar o `git init` aninhado do `nest new` | encontrado ao tentar commitar `api/`; ver Tarefa 3 acima |

### A verificar na Tarefa 6

A correção `de8266a` é uma **previsão**, não um fato observado. Ao abrir apenas
a Security List, o erro esperado muda de `timeout` para `No route to host`. Se
o erro ICMP for filtrado no caminho de volta, pode continuar aparecendo como
timeout. **Anotar aqui o que realmente acontecer.**

---

## Backlog item 1 — `server_name` real e `location` com prefixo ✅

Executado após o fechamento da POC. Referência:
[`backlog.md`](backlog.md) item 1.

### Nome de host

Subdomínio gratuito no DuckDNS: `lcnsilva.duckdns.org` → `129.159.50.172`.

GitHub Pages foi cogitado e **não serve**: ele dá um nome, mas apontando para os
servidores do GitHub, e o DNS dele não é seu. Usar domínio customizado no Pages
exigiria já ter um domínio — a mesma dependência.

DuckDNS foi preferido a `nip.io` por ser DNS editável e por estar na Public
Suffix List, o que dá cota própria de Let's Encrypt a cada subdomínio — o que
importa para o item 2 do backlog.

### Configuração: dois `server` blocks

```nginx
server {
    listen 80;
    server_name lcnsilva.duckdns.org;

    location /api/ {
        proxy_pass http://127.0.0.1:8080/;
        proxy_set_header Host            $host;
        proxy_set_header X-Real-IP       $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    location / {
        root /var/www/poc-api;
        index index.html;
    }
}

server {
    listen 80 default_server;
    server_name _;
    return 444;
}
```

A ordem no arquivo não decide nada: o Nginx compara o header `Host` contra os
`server_name` de todos os blocos daquela porta e, se nenhum casar, usa o marcado
`default_server`.

### Erro encontrado: `duplicate default server`

O `default_server` foi mantido por engano no bloco nomeado, e o Nginx recusou a
configuração:

```
[emerg] a duplicate default server for 0.0.0.0:80 in /etc/nginx/sites-enabled/poc-api:21
```

Só um bloco por porta pode carregar a marca. Reportado na segunda ocorrência.

O `systemctl reload` seguinte falhou com `Job for nginx.service failed` — e
**o Nginx continuou no ar**, com a configuração antiga. Confirmação prática da
correção `b21ec7f`: o mestre rejeita a configuração nova e segue servindo. A
mensagem do systemd relata que o `ExecReload` retornou erro, não que o serviço
morreu.

### A decisão de não usar `setGlobalPrefix`

O backlog previa `setGlobalPrefix('api')` no Nest. Foi descartado de propósito:
com o Nest também usando o prefixo, `proxy_pass` com e sem barra produziriam o
mesmo resultado, e a armadilha que justifica o item desapareceria.

Deixando o Nest servindo `/health` na raiz e o Nginx expondo em `/api/`, a
diferença fica mensurável — e o escopo cai para um arquivo só, sem rebuild nem
redeploy.

### A barra final, com evidência dos dois lados

Mesma URL (`http://lcnsilva.duckdns.org/api/health`), mesmo cliente, um
caractere de diferença na configuração:

```
proxy_pass http://127.0.0.1:8080;   →  GET /api/health   | x-real-ip=177.16.235.121
proxy_pass http://127.0.0.1:8080/;  →  GET /health       | x-real-ip=177.16.235.121
```

Os headers idênticos mostram que apenas o caminho mudou.

A regra: **tem caminho depois da porta?**

| `proxy_pass` | O que o Nginx faz | Chega no Nest |
|---|---|---|
| `http://127.0.0.1:8080` | repassa o URI original inteiro | `/api/health` |
| `http://127.0.0.1:8080/` | substitui o prefixo casado pelo `location` | `/health` |
| `http://127.0.0.1:8080/v2/` | idem, com outro caminho | `/v2/health` |

Não é sobre a barra em si — é sobre existir um caminho. A barra sozinha é o
caminho mais curto possível.

Sem a barra, o 404 vem **do Nest**, em JSON, e não do Nginx em HTML. A
assinatura da resposta já diz quem respondeu.

**Por que isso nunca apareceu durante a POC:** com `location /`, o prefixo
casado é `/`, e substituí-lo por `/` não muda nada. As duas formas são
equivalentes enquanto não houver prefixo a remover.

### Validação

| Comando | Resultado |
|---|---|
| `curl.exe http://lcnsilva.duckdns.org/api/health` | `{"status":"ok"}` |
| `curl.exe http://lcnsilva.duckdns.org/api/info` | JSON com nome, versão e uptime |
| `curl.exe http://lcnsilva.duckdns.org/` | o `index.html` estático |
| `curl.exe --max-time 10 http://129.159.50.172` | `curl: (52) Empty reply from server` |

O último é o ponto do exercício: mesmo IP, mesma porta, mesmo processo Nginx, e
o resultado muda porque o header `Host` mudou. O `return 444` fecha a conexão
sem enviar resposta alguma — código não-padrão do Nginx criado para isso, útil
contra as sondas automatizadas registradas no log durante a Tarefa 7.

**Consequência aceita:** o acesso por IP deixou de funcionar. Toda validação
passa a ser pelo nome.

---

## Backlog item 2 — TLS/HTTPS com Let's Encrypt ✅

Referência: [`backlog.md`](backlog.md) item 2.

### Ordem, e por que essa

1. abrir a porta 443 nas duas camadas
2. emitir o certificado — a validação usa a porta **80**, já aberta
3. só então reescrever o Nginx: se o arquivo apontar para um certificado
   inexistente, o Nginx não sobe

### Certificado: `certonly` + `--webroot`

O certbot foi usado no modo que **não toca** na configuração do Nginx, para que
o bloco TLS fosse escrito à mão — coerente com o objetivo da POC.

```bash
sudo certbot certonly --webroot -w /var/www/poc-api \
  -d lcnsilva.duckdns.org \
  --deploy-hook "systemctl reload nginx"
```

A validação HTTP-01 funciona assim: o Let's Encrypt emite um desafio, o certbot
publica um arquivo em `/.well-known/acme-challenge/`, e o servidor da autoridade
busca esse arquivo pelo domínio, na porta 80. É o que prova controle sobre o
nome.

`--webroot` grava o arquivo no diretório que o Nginx já serve — sem plugin e sem
o certbot reescrever nada.

O `--deploy-hook` é essencial no modo `certonly`: o certbot renova sozinho, mas
não sabe que o Nginx precisa reler o arquivo novo. Sem ele, o certificado é
renovado e o Nginx segue servindo o vencido.

Renovação verificada:

```
sudo certbot renew --dry-run
Congratulations, all simulated renewals succeeded
```

### Configuração: três blocos

- **Porta 80, nomeado** — serve `/.well-known/acme-challenge/` (a renovação
  precisa disso para sempre) e redireciona o resto com `301`. O `location` do
  desafio vence o `/` por ser prefixo mais longo, independente da ordem.
- **Porta 443, nomeado** — o certificado, o proxy para a API e o estático.
- **Catch-all, 80 e 443** — `return 444` e `ssl_reject_handshake on`.

Arquivo completo versionado em [`../nginx/poc-api.conf`](../nginx/poc-api.conf).

`X-Forwarded-Proto $scheme` entrou no proxy: a conexão do Nginx até a API é
sempre HTTP puro no loopback, então sem esse header a aplicação não tem como
saber que o cliente veio por HTTPS.

### Erro encontrado: a porta 443 esquecida

Com a configuração no ar, o redirecionamento funcionou de primeira:

```
HTTP/1.1 301 Moved Permanently
Location: https://lcnsilva.duckdns.org/api/health
```

E o HTTPS deu `timeout`. O passo 1 do plano — abrir a 443 — tinha ficado para
trás, porque o certificado e o Nginx eram os passos visíveis, e a porta 80 já
estava aberta desde a Tarefa 6.

Diagnóstico na sequência aprendida, do mais barato ao mais caro:

```bash
sudo ss -tlnp sport = :443        # Nginx escutando em 0.0.0.0:443 ✓
sudo iptables -L INPUT -n --line-numbers   # só 22 e 80 antes do REJECT ✗
```

Depois de inserir a regra do iptables, ainda timeout. O `tcpdump` fechou a
questão — toda a captura era tráfego de **saída** da VM (snap, agente da OCI),
e nenhum SYN do cliente:

```
10.0.0.215.33058 > 192.29.130.105.443    ← saída, ruído
(nenhuma linha 177.16.235.121 > 10.0.0.215.443)
```

Faltava a regra na Security List. Filtro mais preciso para a próxima vez:

```bash
sudo tcpdump -ni ens3 tcp dst port 443 and src host <ip-do-cliente>
```

Ordem final do iptables, com a 443 antes do `REJECT`:

```
4  ACCEPT  tcp dpt:22
5  ACCEPT  tcp dpt:80
6  ACCEPT  tcp dpt:443
7  REJECT  reject-with icmp-host-prohibited
```

### Validação

| Comando | Resultado |
|---|---|
| `curl.exe -I http://lcnsilva.duckdns.org/api/health` | `301` com `Location: https://...` |
| `curl.exe https://lcnsilva.duckdns.org/api/health` | `{"status":"ok"}`, sem aviso de certificado |
| `sudo certbot renew --dry-run` | simulação bem-sucedida |
| `curl.exe -k --max-time 10 https://129.159.50.172` | `curl: (35) schannel: ... fatal SSL/TLS alert received` |

O último confirma o catch-all em TLS. O `-k` desliga a *validação* do
certificado e não ajuda, porque não há certificado a validar: o
`ssl_reject_handshake on` aborta a negociação antes disso.

Sem esse bloco, o Nginx elegeria o bloco nomeado como padrão da porta 443, e
qualquer sonda que se conectasse por IP receberia o certificado de
`lcnsilva.duckdns.org` antes de qualquer verificação de `Host`.

**Ressalva:** isso não esconde o domínio. Certificados do Let's Encrypt vão para
os logs públicos de Certificate Transparency, então o nome é descobrível de
qualquer forma. O ganho é não servir o site a requisições com `Host` alheio.

---

## Checkpoint final

Estado depois da POC e dos itens 1 e 2 do backlog.

| Item | Estado |
|---|---|
| `curl.exe https://lcnsilva.duckdns.org/api/health` retorna o JSON | ✅ |
| `curl.exe https://lcnsilva.duckdns.org/api/info` retorna o JSON | ✅ |
| `http://` redireciona para `https://` com `301` | ✅ |
| Certificado válido, sem aviso no cliente | ✅ |
| `certbot renew --dry-run` bem-sucedido | ✅ |
| Acesso por IP recusado, em HTTP (`444`) e em TLS (handshake abortado) | ✅ |
| `sudo ss -tlnp \| grep 8080` mostra `127.0.0.1:8080` | ✅ |
| `docker logs poc-api` registra o IP público real do cliente | ✅ |
| Após `sudo reboot`, tudo continua funcionando sem intervenção | ✅ até a Tarefa 6; não revalidado após a porta 443 |
| Revisões conceituais das Tarefas 2 a 7 | ✅ |
| `nginx/poc-api.conf` idêntico ao arquivo em uso na VM | ✅ |
| `docker logs` registrando o `X-Forwarded-Proto` | ⬜ pendência menor |

### O caminho completo, de ponta a ponta

```
cliente (177.16.235.121)
   │  HTTPS :443     (:80 responde 301 e serve o desafio ACME)
   ▼
Internet Gateway ──> Route Table (0.0.0.0/0) ──> Subnet pública
   │
   ▼
Security List: ACCEPT tcp dport 80, 443       ← camada 1, fora da VM
   │
   ▼
iptables INPUT regras 5 e 6                   ← camada 2, dentro da VM
   │
   ▼
Nginx: escolhe o server block pelo header Host
   │      ├─ Host = lcnsilva.duckdns.org ──> termina o TLS, aplica o location
   │      └─ qualquer outro ──────────────> 444 / handshake recusado
   ▼
location /api/  ──  proxy_pass + 4 headers  (HTTP puro daqui em diante)
   │
   ▼
docker-proxy (127.0.0.1:8080)
   │
   ▼
container 172.17.0.2:8080  ──  NestJS ouvindo em 0.0.0.0
```

Seis pontos de bloqueio possíveis, e o `Host` como sétima condição — quase todos
com o mesmo sintoma quando falham. A ordem do plano — provar rede com conteúdo
estático antes de introduzir o proxy, e abrir a porta antes de emitir o
certificado — existe para que nunca houvesse mais de um suspeito por vez.

O TLS termina no Nginx. Da porta 8080 em diante o tráfego é HTTP puro, no
loopback — por isso a aplicação depende do `X-Forwarded-Proto` para saber que o
cliente veio por HTTPS.

### Onde a intuição falhou

Lista dos pontos em que o comportamento observado contrariou o previsto,
inclusive por mim. Todos estão detalhados nas seções acima.

1. **`Connection refused` não é `timeout`.** O primeiro prova que o pacote fez
   o caminho de ida e a resposta fez o de volta; o segundo não prova nada.
2. **As duas camadas de firewall dão o mesmo sintoma.** A previsão de que o
   `REJECT` do iptables produziria `No route to host` não se confirmou: o ICMP
   é filtrado no retorno. `tcpdump` é o que distingue.
3. **Reload com configuração inválida não derruba o Nginx.** O mestre mantém a
   configuração antiga. O risco é a mudança não ser aplicada em silêncio.
4. **`nginx -t` não detecta "esqueci de aplicar".** A configuração antiga
   também é válida. Quem responde é `nginx -T`.
5. **O container vê `172.17.0.1`, não `127.0.0.1`.** O `docker-proxy` abre uma
   conexão nova pela bridge — já havia um proxy no caminho antes do Nginx.
6. **O iptables não protege porta publicada por container.** O Docker escreve
   DNAT em `PREROUTING` e o tráfego segue por `FORWARD`, contornando a `INPUT`.
7. **A barra final do `proxy_pass` não é cosmética.** Sem caminho após a porta,
   o URI é repassado inteiro; com caminho, o prefixo casado pelo `location` é
   substituído. Invisível enquanto o `location` é `/`.
8. **Um `reload` recusado mantém o serviço no ar.** Confirmado ao vivo com o
   `duplicate default server`: o `systemctl reload` falhou, e o Nginx seguiu
   servindo com a configuração antiga.
9. **Abrir uma porta nova exige as duas camadas de novo.** A 443 foi esquecida
   porque a 80 já estava aberta e o redirecionamento funcionava — o passo
   visível havia sido o certificado.
10. **Um `default_server` em TLS entrega seu certificado a qualquer sonda.**
    Sem um bloco catch-all na 443, o Nginx elege o bloco nomeado como padrão e
    apresenta o certificado antes de qualquer verificação de `Host`.

---

## Fora de escopo

A spec original excluía TLS/HTTPS, certificados, domínio próprio, rate
limiting, fail2ban, load balancing e automação de deploy.

Depois do checkpoint da Tarefa 7, os três primeiros foram feitos como itens 1 e
2 do backlog — registrados acima. **Continuam fora de escopo:**

- rate limiting e fail2ban — Fase 3, com spec e plano próprios
- load balancing entre múltiplas instâncias
- automação de deploy: CI/CD, unit do systemd para a aplicação

O `--restart unless-stopped` do container e o timer de renovação do certbot são
a única automação existente.
