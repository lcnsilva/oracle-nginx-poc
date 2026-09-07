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

## 3. Exercício

### Parte A — no Windows (Tarefa 3)

1. **Antes de escrever código**, anote o JSON exato que `/health` e `/info`
   devem retornar. Sem esse critério escrito, "funcionou" vira opinião, e as
   validações das tarefas seguintes ficam sem referência.
2. Criar o projeto com `npx @nestjs/cli new api`.
3. Rodar e chamar `/health` **antes** de implementar, para ver o 404. Confirmar
   que a ferramenta de teste funciona antes de testar o código é o que separa
   "meu código está errado" de "meu comando está errado".
4. Implementar os dois endpoints.
5. Mudar a porta para 8080 e o bind para `0.0.0.0` no bootstrap.
6. Validar com `curl.exe`.

### Parte B — Dockerfile e VM (Tarefa 4)

7. Escrever o `.dockerignore` (no mínimo `node_modules` e `dist`).
8. Escrever o `Dockerfile` multi-stage.
9. Commitar, dar push, clonar na VM.
10. Buildar e rodar com `-p 127.0.0.1:8080:8080`.
11. Validar com `curl` e confirmar o bind com `ss`.

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
