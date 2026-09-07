# 01 — API NestJS em container Docker

> Corresponde às **Tarefas 3 e 4** do plano de implementação.
> Pré-requisito: Tarefa 2 concluída (VM acessível, Docker e swap prontos).

A API aqui é veículo, não destino. Dois endpoints bastam. O que interessa
nesta etapa é entender o que o container faz com a **rede** — porque é isso que
determina se o Nginx vai conseguir alcançar a API, e se o mundo vai conseguir
alcançá-la sem passar pelo Nginx.

---

## 1. Conceito

### O `localhost` do container não é o `localhost` do host

Cada container tem sua própria pilha de rede: interface, endereço IP e tabela
de rotas próprios. Dentro do container, `127.0.0.1` significa "este container",
não "esta máquina".

Consequência direta, e o erro mais comum de quem containeriza uma aplicação
Node pela primeira vez:

- `app.listen(8080)` — o Nest liga o socket em `127.0.0.1:8080`, ou seja, no
  loopback **do container**. Só processos dentro daquele container alcançam.
  De fora, conexão recusada.
- `app.listen(8080, '0.0.0.0')` — liga em todas as interfaces do container,
  inclusive a que o Docker usa para conectá-lo ao host. Agora é alcançável.

O sintoma do erro é enganoso: a aplicação sobe, o log diz que está escutando,
`docker ps` mostra tudo saudável, e o `curl` falha. Nada aponta para o bind.

### O que `-p` faz de verdade — e por que isso é uma questão de segurança

`-p 8080:8080` é frequentemente descrito como "mapear a porta". A descrição é
incompleta de um jeito que importa.

O Docker implementa a publicação de portas **escrevendo regras de iptables**
na tabela `nat`, em `PREROUTING`. Essas regras são avaliadas **antes** da chain
`INPUT` — que é justamente onde ficam as regras de firewall da VM.

O efeito prático: **as suas regras de firewall não filtram portas publicadas
por container**. Uma porta publicada com `-p 8080:8080` fica acessível de fora
mesmo que você jamais tenha escrito uma regra permitindo a 8080. Basta a
Security List da OCI permitir, e ela está na internet.

É por isso que esta POC usa:

```
-p 127.0.0.1:8080:8080
```

O prefixo `127.0.0.1:` instrui o Docker a publicar a porta **apenas no loopback
do host**. Quem está na VM alcança — e o Nginx está na VM. Quem está fora, não
alcança de forma alguma, independentemente de firewall.

Isso é exatamente o que se quer de um serviço atrás de um proxy reverso: a
única porta exposta à internet é a 80, servida pelo Nginx. A API não tem porta
pública nenhuma.

### `0.0.0.0` no `listen` e `127.0.0.1` no `-p` ao mesmo tempo

Parece contradição e não é. São dois limites diferentes, em duas máquinas
diferentes:

- `0.0.0.0` é o bind **dentro do container**: "aceite conexões vindas de
  qualquer interface deste container". Sem isso, o Docker não consegue nem
  entregar o tráfego.
- `127.0.0.1:` no `-p` é o bind **no host**: "publique esta porta somente no
  loopback da VM".

O primeiro abre a porta interna; o segundo restringe onde ela aparece do lado
de fora. Um sem o outro não funciona ou não é seguro.

### Build multi-stage

Um Dockerfile comum instala dependências, compila e mantém tudo na imagem
final: código-fonte TypeScript, `devDependencies`, cache do npm, compilador. O
resultado é uma imagem grande, cheia de coisa que nunca roda em produção.

Um build **multi-stage** usa mais de uma imagem base no mesmo Dockerfile:

- **Estágio de build:** instala todas as dependências, roda o build do Nest,
  produz o `dist/`.
- **Estágio final:** parte de uma imagem limpa e copia apenas o resultado do
  build e as dependências de produção.

Ganhos que importam nesta POC: menos disco numa VM Always Free, menos tempo de
`docker pull` em futuros deploys e menos superfície de ataque — compilador e
ferramenta de build não vão para a imagem que roda exposta.

### Por que buildar na VM e não localmente

Este projeto escolheu desenvolver no Windows e buildar na VM via `git clone`.
A vantagem é não precisar de registry nem de Docker no Windows. O custo é que
o build acontece em 1 OCPU / 1 GB — daí o swap ser pré-requisito, e não
detalhe.

---

## 2. Referências oficiais

- **NestJS — First Steps** — https://docs.nestjs.com/first-steps
- **NestJS — Controllers** — https://docs.nestjs.com/controllers
- **Dockerfile reference** — https://docs.docker.com/reference/dockerfile/
- **Multi-stage builds** — https://docs.docker.com/build/building/multi-stage/
- **Container networking** — https://docs.docker.com/engine/network/

---

## 3. Configuração anotada

Criar o projeto:

```bash
npx @nestjs/cli new api
```

Antes de editar qualquer coisa, rode `npm run start` e chame
`curl.exe http://localhost:3000/health`. Esperado: **404**. Confirmar que a
ferramenta de teste funciona antes de testar o código é o que separa "meu
código está errado" de "meu comando está errado".

### 3.1 `api/src/app.controller.ts`

Substitui o controller gerado pelo `nest new`:

```typescript
import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
  @Get('health')
  health() {
    return { status: 'ok' };
  }

  @Get('info')
  info() {
    return {
      name: 'poc-api',
      version: '1.0.0',
      uptime: Math.floor(process.uptime()),
    };
  }
}
```

| Linha | O que faz |
|---|---|
| `@Controller()` | declara a classe como controller. Sem argumento, não há prefixo de rota — os caminhos ficam `/health` e `/info`, e não `/algo/health` |
| `@Get('health')` | associa o método ao `GET /health` |
| `return { ... }` | o Nest serializa o objeto para JSON e define o `Content-Type` automaticamente. Não é preciso mexer no objeto de resposta |
| `process.uptime()` | segundos desde o início do processo Node. Útil para ver, depois, se o container reiniciou |

O `app.service.ts` gerado pelo `nest new` deixa de ser usado. Pode ser
removido, junto com sua injeção no `app.module.ts` — ou deixado como está, sem
efeito.

Referência: https://docs.nestjs.com/controllers

### 3.2 `api/src/main.ts`

```typescript
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(8080, '0.0.0.0');
}
bootstrap();
```

A única mudança em relação ao arquivo gerado é a linha do `listen`. O
`nest new` escreve algo como `await app.listen(process.env.PORT ?? 3000)`.

| Argumento | Por quê |
|---|---|
| `8080` | porta interna definida pela POC. O `nest new` usa 3000; se você não trocar, o `-p` do Docker aponta para uma porta onde não há nada e o `curl` recusa conexão |
| `'0.0.0.0'` | bind em todas as interfaces do container. **Sem este segundo argumento**, o Nest liga no loopback do container e fica inalcançável de fora dele |

Rodando no Windows, o `0.0.0.0` não muda nada visível. Ele só passa a importar
na Tarefa 4. Fazer a mudança agora evita depurar isso mais tarde misturado com
suspeita de Docker.

Referência: https://docs.nestjs.com/first-steps

### 3.3 `api/Dockerfile`

> **Procedência.** Este é o único artefato desta POC que não é transcrição de
> documentação oficial. O NestJS não publica Dockerfile oficial; o arquivo
> abaixo é composto a partir do guia de multi-stage build do Docker
> (https://docs.docker.com/build/building/multi-stage/) e da referência de
> Dockerfile (https://docs.docker.com/reference/dockerfile/).

```dockerfile
# --- Estágio 1: build ---
FROM node:24-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# --- Estágio 2: runtime ---
FROM node:24-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist

EXPOSE 8080
CMD ["node", "dist/main.js"]
```

| Linha | O que faz |
|---|---|
| `FROM node:24-alpine AS builder` | imagem base do primeiro estágio. `alpine` é uma distribuição mínima — imagem muito menor. `AS builder` nomeia o estágio para ser referenciado depois |
| `WORKDIR /app` | define o diretório de trabalho e o cria. Substitui um `mkdir` + `cd` |
| `COPY package*.json ./` | copia **só** os manifestos, antes do código. Enquanto as dependências não mudarem, o Docker reaproveita a camada do `npm ci` em builds seguintes |
| `RUN npm ci` | instala exatamente o que está no `package-lock.json`. Diferente de `npm install`, não atualiza o lock — build reproduzível |
| `COPY . .` | agora sim o código-fonte. Fica depois do `npm ci` de propósito: mudar o código não invalida a camada de dependências |
| `RUN npm run build` | compila o TypeScript para `dist/` |
| `FROM node:24-alpine` (2ª vez) | começa uma imagem nova, do zero. Nada do estágio anterior vem junto, exceto o que for copiado explicitamente |
| `ENV NODE_ENV=production` | sinaliza modo produção para o Node e para bibliotecas que consultam essa variável |
| `npm ci --omit=dev` | instala só dependências de produção. TypeScript, ESLint e o CLI do Nest ficam de fora |
| `npm cache clean --force` | remove o cache do npm da camada final. Sem isso, o cache vai junto na imagem |
| `COPY --from=builder /app/dist ./dist` | traz apenas o resultado compilado do primeiro estágio. É esta linha que faz o multi-stage valer a pena |
| `EXPOSE 8080` | documenta a porta usada. **Não publica nada** — publicar é papel do `-p` no `docker run` |
| `CMD ["node", "dist/main.js"]` | comando de início. Forma com colchetes (*exec form*) executa o binário direto, sem shell intermediário, o que faz o sinal de parada do Docker chegar ao Node |

Sobre a versão fixada: `node:24-alpine` é uma linha LTS, escolhida por
coincidir com o Node instalado na máquina de desenvolvimento (`node --version`
local: v24). Manter as duas iguais elimina uma variável quando algo funcionar
localmente e falhar no container.

Fixar a versão maior também evita que um build futuro troque de Node sem aviso.
Se a sua VM for ARM (shape Ampere), a mesma tag funciona — a imagem oficial do
Node publica `arm64`.

### 3.4 `api/.dockerignore`

```
node_modules
dist
.git
Dockerfile
.dockerignore
npm-debug.log
```

| Entrada | Por quê |
|---|---|
| `node_modules` | o `COPY . .` levaria o `node_modules` do **Windows** para dentro da imagem Linux. Além de inflar o build, dependências com binários compilados quebram por diferença de plataforma |
| `dist` | o build acontece dentro da imagem. Copiar um `dist` local arrisca subir código velho |
| `.git` | histórico inteiro do repositório, sem utilidade em runtime |
| `Dockerfile`, `.dockerignore` | não são usados pela aplicação |
| `npm-debug.log` | ruído de builds falhos anteriores |

### 3.5 Build e execução na VM

```bash
git clone <url-do-repositorio> ~/poc-nginx
cd ~/poc-nginx/api
docker build -t poc-api .
docker run -d --name poc-api --restart unless-stopped -p 127.0.0.1:8080:8080 poc-api
```

| Trecho | O que faz |
|---|---|
| `docker build -t poc-api .` | constrói a imagem e a nomeia `poc-api`. O `.` é o *build context*: o diretório enviado ao daemon, filtrado pelo `.dockerignore` |
| `-d` | *detached* — o container roda em segundo plano e o terminal volta |
| `--name poc-api` | nome fixo, para os comandos `docker logs` e `docker stop` seguintes |
| `--restart unless-stopped` | o Docker reinicia o container no boot da VM e após falhas, exceto se você o parou de propósito. É o que faz a POC sobreviver ao `reboot` da Tarefa 6 |
| `-p 127.0.0.1:8080:8080` | publica a porta **somente no loopback do host**. O prefixo `127.0.0.1:` é o que impede a API de ficar exposta à internet |
| `poc-api` (último) | a imagem a executar |

Em 1 OCPU / 1 GB o build leva vários minutos e usa swap. Lentidão é esperada;
um `Killed` não é — se acontecer, o swap da Tarefa 2 não está ativo.

Referência: https://docs.docker.com/engine/network/

---

## 4. Como validar

No Windows, com a aplicação rodando localmente:

```bash
curl.exe http://localhost:8080/health
curl.exe http://localhost:8080/info
```

Esperado: os JSONs que você definiu no passo 1.

Na VM, com o container rodando:

```bash
curl localhost:8080/health
```

Esperado: o mesmo JSON.

```bash
sudo ss -tlnp | grep 8080
```

Esperado: o socket em `127.0.0.1:8080`.
**Se aparecer `0.0.0.0:8080`, a API está exposta à internet** assim que a
Tarefa 6 abrir o firewall. Remova o container e refaça o `docker run` com o
prefixo correto.

---

## 5. Armadilhas

**`app.listen(8080)` sem o `0.0.0.0`.**
Funciona no Windows, falha dentro do container. Como você testa localmente
primeiro, o erro só aparece na VM, misturado com suspeita de Docker. Faça a
mudança já na Tarefa 3, mesmo sem efeito visível ali.

**`-p 8080:8080` em vez de `-p 127.0.0.1:8080:8080`.**
Expõe a API diretamente à internet, contornando o Nginx. Como funciona nos
testes, o erro passa despercebido — a validação com `ss` existe para pegá-lo.

**`curl` no PowerShell.**
No Windows PowerShell, `curl` é alias de `Invoke-WebRequest`: flags diferentes,
saída diferente, mensagens de erro que não correspondem ao que você digitou.
Use sempre `curl.exe`.

**Build morto com `Killed`.**
Falta de memória, não erro do npm. Confirme o swap com `free -h`.

**`node_modules` do Windows dentro da imagem.**
Sem `.dockerignore`, o `COPY` leva o `node_modules` da sua máquina para a
imagem. Além de inflar o build, dependências com binários compilados quebram
por diferença de plataforma.

**A porta 3000 padrão do Nest.**
`nest new` gera o bootstrap com 3000. Se você esquecer de trocar, o
`EXPOSE`/`-p` apontando para 8080 não encontra nada e o `curl` recusa conexão.

---

**Anterior:** [`00-provisionamento-oci.md`](00-provisionamento-oci.md)
**Próximo:** [`02a-nginx-estatico-e-rede.md`](02a-nginx-estatico-e-rede.md)
