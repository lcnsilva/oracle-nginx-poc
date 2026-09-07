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
| 2A | 6 — Abrir a porta 80 nas duas camadas | 🔄 próxima |
| 2B | 7 — Proxy reverso | ⬜ não iniciada |

**Próximo passo:** Tarefa 6 — abrir a porta 80 na Security List e no iptables.

Ideias levantadas fora do escopo estão em [`backlog.md`](backlog.md).

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

## Correções feitas no material durante a execução

O material foi escrito antes da execução e mudou por causa dela. Registro do
que mudou e por quê:

| Commit | Mudança | Motivo |
|---|---|---|
| `b7693bf` | modo de trabalho: de exercício sem gabarito para configuração pronta e anotada | pedido do usuário: entregar o "como", desde que ancorado na documentação oficial |
| `b7693bf` | removido o passo que pedia ao usuário validar se a apostila ensinava bem | avaliação impossível para quem ainda não conhece o assunto |
| `8a27d82` | apostila 00 reescrita para o caminho manual de criação da rede, com os campos de CIDR | o assistente não foi usado, e o caminho manual expõe as peças que a POC quer ensinar |
| `8a27d82` | documentados `Connection refused` x `timeout`, seção *Security* e VNIC do formulário, e o IP público invisível dentro do Ubuntu | dúvidas e erros reais encontrados na execução |
| `de8266a` | corrigida a previsão de sintoma das duas camadas de firewall | a apostila afirmava sintoma idêntico; a Security List descarta (timeout) e o iptables da imagem responde com `REJECT` (`No route to host`) |
| `5675e2f` | `Dockerfile` de `node:22-alpine` para `node:24-alpine` | alinhar com o Node v24 instalado na máquina de desenvolvimento |
| — | documentar o `git init` aninhado do `nest new` | encontrado ao tentar commitar `api/`; ver Tarefa 3 acima |

### A verificar na Tarefa 6

A correção `de8266a` é uma **previsão**, não um fato observado. Ao abrir apenas
a Security List, o erro esperado muda de `timeout` para `No route to host`. Se
o erro ICMP for filtrado no caminho de volta, pode continuar aparecendo como
timeout. **Anotar aqui o que realmente acontecer.**

---

## Fora de escopo desta POC

TLS/HTTPS e certificados, rate limiting, fail2ban, load balancing, automação de
deploy, domínio próprio. Rate limiting e fail2ban ganham spec e plano próprios
depois do checkpoint da Tarefa 7.
