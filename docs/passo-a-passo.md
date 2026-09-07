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
| 1 | 3 — API NestJS local | 🔄 passos 1–3 feitos, 4–7 pendentes |
| 1 | 4 — Dockerfile e deploy na VM | ⬜ não iniciada |
| 2A | 5 — Nginx servindo estático | ⬜ não iniciada |
| 2A | 6 — Abrir a porta 80 nas duas camadas | ⬜ não iniciada |
| 2B | 7 — Proxy reverso | ⬜ não iniciada |

**Próximo passo:** Tarefa 3, passo 4 — escrever `api/src/app.controller.ts`.

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

## Tarefa 3 — API NestJS local 🔄

Material: [`apostila/01-api-nestjs-docker.md`](apostila/01-api-nestjs-docker.md)

### Critério de aceitação definido

```
GET /health  →  {"status":"ok"}
GET /info    →  {"name":"poc-api","version":"1.0.0","uptime":<segundos>}
```

### Feito

- [x] **Passo 1** — critério de aceitação escrito (acima)
- [x] **Passo 2** — projeto criado com `npx @nestjs/cli new api`, gerenciador npm
- [x] **Passo 3** — `npm run start` + `curl.exe http://localhost:3000/health`
      retornando 404, confirmando que o servidor sobe e o `curl.exe` funciona
      antes de haver código a testar

### Pendente

- [ ] **Passo 4** — escrever `api/src/app.controller.ts` com `/health` e `/info`
- [ ] **Passo 5** — em `api/src/main.ts`, trocar o `listen` para
      `app.listen(8080, '0.0.0.0')`
- [ ] **Passo 6** — validar os dois endpoints na porta 8080, e confirmar que a
      3000 passou a recusar conexão
- [ ] **Passo 7** — commit

O código dos passos 4 e 5 está anotado linha a linha em
[`apostila/01-api-nestjs-docker.md`](apostila/01-api-nestjs-docker.md),
seções 3.1 e 3.2.

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
| pendente | `Dockerfile` de `node:22-alpine` para `node:24-alpine` | alinhar com o Node v24 instalado na máquina de desenvolvimento |

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
