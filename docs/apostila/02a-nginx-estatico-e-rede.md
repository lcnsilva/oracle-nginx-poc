# 02a — Nginx servindo conteúdo estático, e as duas camadas de firewall

> Corresponde às **Tarefas 5 e 6** do plano de implementação.
> Pré-requisito: Tarefas 2, 3 e 4 concluídas (container respondendo em
> `127.0.0.1:8080` na VM).

Esta é a apostila central da POC. Ela cobre duas coisas que normalmente são
estudadas separadas — a configuração do Nginx e a rede da OCI — e as junta de
propósito, porque juntas elas formam o problema real: **um serviço só está no
ar quando as duas estão certas, e quando falha, o sintoma é o mesmo.**

---

## 1. Conceito

### 1.1 O que é um proxy reverso (visão geral)

Um proxy comum fica na frente do *cliente*: seu navegador fala com o proxy, e o
proxy fala com os sites. Um proxy **reverso** fica na frente do *servidor*: o
mundo fala com o proxy, e o proxy fala com a sua aplicação.

Para quem chama, o proxy reverso *é* a aplicação. A aplicação real fica atrás,
sem porta pública, e pode ser trocada, reiniciada ou multiplicada sem que o
endereço externo mude.

Nesta POC, o Nginx é esse intermediário: única coisa exposta na porta 80, com a
API NestJS escondida em `127.0.0.1:8080`. A configuração do encaminhamento em
si é assunto da apostila 02b — aqui o Nginx ainda serve apenas um arquivo
estático.

### 1.2 TLS e HTTPS — o conceito, sem implementação

HTTP trafega em texto claro: quem estiver no caminho entre cliente e servidor
lê tudo. TLS (*Transport Layer Security*) é a camada que criptografa esse
tráfego; HTTPS é simplesmente HTTP rodando dentro de TLS — o "S" vem daí.

Para funcionar, o servidor apresenta um **certificado** emitido por uma
autoridade certificadora, que o navegador confere. Certificados gratuitos e
automatizados existem (Let's Encrypt), mas exigem um domínio próprio — não se
emite certificado para um IP.

Esta POC fica em HTTP na porta 80. TLS está **fora de escopo** e ganha projeto
próprio depois. Fica registrado por que: falta um domínio, e adicionar
certificado agora acrescentaria uma segunda variável a cada falha de rede.

Referência para depois: https://nginx.org/en/docs/http/configuring_https_servers.html

### 1.3 A estrutura do arquivo de configuração

O Nginx é configurado por **diretivas**, de dois tipos.

**Diretiva simples** — um nome, argumentos, ponto e vírgula no fim:

```
worker_processes  auto;
```

**Diretiva de bloco** — mesma coisa, mas terminada por um par de chaves com
outras diretivas dentro:

```
events {
    worker_connections  1024;
}
```

Um bloco que contém outras diretivas é chamado de **contexto**. Quatro
contextos importam nesta POC:

| Contexto | Onde fica | O que governa |
|---|---|---|
| `main` | o próprio arquivo, fora de qualquer bloco | processo do Nginx: usuário, número de workers, arquivo de PID |
| `http` | dentro do `main` | tudo relacionado a tráfego HTTP: logs, tipos MIME, timeouts |
| `server` | dentro do `http` | um site: em qual porta escuta, para qual nome de host responde |
| `location` | dentro do `server` | um conjunto de caminhos de URL dentro daquele site |

Diretivas são herdadas de fora para dentro: o que você define no `http` vale
para todos os `server`, salvo se um `server` redefinir. Entender essa herança
é o que evita duplicar a mesma linha em dez lugares.

### 1.4 Como o Nginx escolhe o `location`

Para cada requisição, o Nginx primeiro escolhe o `server` (pela porta e pelo
nome do host) e depois escolhe **um único** `location` dentro dele.

A escolha não é "o primeiro que casa". Simplificando as regras que importam
agora:

1. Prefixos são comparados; o **mais longo** que casa é o candidato.
2. Expressões regulares são testadas na ordem em que aparecem; a primeira que
   casa vence sobre o candidato por prefixo.
3. `location /` casa com tudo e é o mais curto possível — funciona como
   fallback.

O ponto prático: um `location` mais específico ganha do genérico
independentemente da ordem em que você os escreveu. Isso vale a pena testar na
prática, e é o que a Tarefa 5 pede que você observe.

Detalhe completo: https://nginx.org/en/docs/http/ngx_http_core_module.html#location

### 1.5 Controlar o processo: `reload`, `quit`, `stop`

O Nginx roda como um processo mestre e vários workers. Os sinais de controle
existem porque recarregar um servidor web sob tráfego não pode derrubar
conexões em andamento.

| Comando | O que faz |
|---|---|
| `nginx -s reload` | relê a configuração, sobe workers novos e deixa os antigos terminarem as requisições que já estavam atendendo |
| `nginx -s quit` | encerra graciosamente: para de aceitar conexões novas e espera as atuais terminarem |
| `nginx -s stop` | encerra imediatamente, cortando conexões em andamento |
| `nginx -t` | testa a sintaxe do arquivo sem aplicar nada |

`reload` é o que você usa depois de cada edição. `quit` é para desligar de
verdade. `stop` é para emergência.

**No Ubuntu há uma camada a mais:** o Nginx é gerenciado pelo systemd, e o
comando idiomático passa a ser `sudo systemctl reload nginx`, que por baixo
envia o mesmo sinal. Os dois funcionam. Saber que `systemctl reload` é um
invólucro de `nginx -s reload` evita a confusão de achar que são mecanismos
diferentes.

**`nginx -t` antes de todo reload.** Recarregar com sintaxe inválida é uma das
poucas formas de derrubar o serviço por descuido.

Referência: https://nginx.org/en/docs/beginners_guide.html#control

### 1.6 `sites-available` e `sites-enabled`: convenção do Ubuntu, não do Nginx

Se você ler o Beginner's Guide do nginx.org e depois olhar o `/etc/nginx` de um
Ubuntu, vai encontrar pastas que a documentação oficial nunca menciona. Elas
não são do Nginx — são do empacotamento Debian/Ubuntu:

- **`sites-available/`** — todos os sites que existem na máquina, ativos ou não.
- **`sites-enabled/`** — apenas symlinks apontando para os arquivos de
  `sites-available` que devem estar no ar.

O `nginx.conf` do pacote inclui `sites-enabled/*`. Habilitar um site é criar o
symlink; desabilitar é removê-lo. O arquivo de configuração continua existindo
nos dois casos, o que torna trivial ligar e desligar um site sem perder nada.

O Nginx compilado a partir do código-fonte não tem essas pastas — costuma usar
`conf.d/`. Nenhuma das duas é "a certa"; é convenção de distribuição. Saber
disso resolve boa parte da confusão de quem segue a documentação oficial e um
tutorial de Ubuntu ao mesmo tempo.

O pacote também já vem com um site `default` habilitado, escutando na porta 80 —
é a página "Welcome to nginx!". Ele precisa sair do caminho antes do seu
`server` block assumir a porta.

### 1.7 As duas camadas de firewall

Este é o conceito que a POC inteira foi ordenada para ensinar.

Um pacote vindo da internet até a sua API atravessa, nesta ordem:

```
internet
   │
   ▼
Security List da OCI      ← camada 1: firewall de rede, fora da VM
   │
   ▼
iptables do Ubuntu        ← camada 2: firewall do sistema, dentro da VM
   │
   ▼
Nginx (porta 80)
   │
   ▼
container (127.0.0.1:8080)
```

**Camada 1 — Security List (OCI).** Roda na infraestrutura da Oracle. Bloqueia
antes do pacote tocar a VM. Você a configura pelo Console web.

**Camada 2 — iptables (Ubuntu).** Roda dentro da VM. A imagem Ubuntu da Oracle
**já vem com regras ativas**, liberando praticamente só a porta 22. Isso
surpreende quem espera uma máquina "limpa": você não instalou firewall nenhum,
e há um firewall.

As duas precisam permitir a porta 80. Abrir uma só produz **exatamente o mesmo
sintoma** de não abrir nenhuma: timeout. Não há mensagem distinguindo os casos.

É daí que vem a estratégia deste plano: abrir as duas camadas enquanto o Nginx
ainda serve um arquivo estático já validado localmente. Assim, quando o acesso
externo falha, sobra um suspeito só.

### 1.8 iptables: por que a ordem das regras decide tudo

O iptables avalia as regras de uma chain **em ordem, de cima para baixo**, e
para na primeira que casa. A chain `INPUT` da imagem Ubuntu da Oracle termina
com uma regra assim:

```
REJECT     all  --  0.0.0.0/0  0.0.0.0/0  reject-with icmp-host-prohibited
```

"Rejeite tudo que chegou até aqui." Como ela casa com qualquer pacote, **nada
depois dela é alcançável**.

Consequência prática, e o erro mais difícil de diagnosticar desta POC:

- `sudo iptables -A INPUT ...` — o `-A` (*append*) acrescenta ao **final** da
  chain, depois do `REJECT`. A regra é criada, aparece normalmente em
  `iptables -L`, e **não tem efeito nenhum**.
- `sudo iptables -I INPUT <N> ...` — o `-I` (*insert*) coloca a regra na
  posição `N`, antes do `REJECT`. Funciona.

O que torna esse erro caro é que a regra *parece* existir. Você lista as regras,
vê a linha da porta 80, conclui que o firewall está certo e vai procurar o
problema no Nginx — onde ele não está.

Para descobrir o número da linha do `REJECT`:

```bash
sudo iptables -L INPUT --line-numbers
```

**A regra da porta 22 não pode ser tocada.** Se ela for removida, ou acabar
depois do `REJECT`, você perde o acesso SSH à VM permanentemente.

**As regras não persistem sozinhas.** Elas vivem em memória; um reboot restaura
o conteúdo de `/etc/iptables/rules.v4`. Salvar exige:

```bash
sudo netfilter-persistent save
```

Sem isso, a POC "para de funcionar sozinha" depois de um reinício.

### 1.9 Por que não usar `ufw`

`ufw` é o gerenciador de firewall amigável do Ubuntu, e é o que praticamente
todo tutorial da internet manda usar. **A Oracle recomenda explicitamente não
usá-lo nas imagens Ubuntu da OCI.**

Motivo: o `ufw` não acrescenta regras ao conjunto existente — ele gerencia o
conjunto inteiro, com a própria estrutura de chains. Ao ser ativado sobre as
regras que a imagem da Oracle já traz, ele as substitui. Se a política dele não
contemplar a porta 22 exatamente como estava, o acesso SSH cai no mesmo
instante, com você do lado de fora.

Referência, seção "Essential Firewall Rules":
https://docs.oracle.com/en-us/iaas/Content/Compute/References/bestpracticescompute.htm

---

## 2. Referências oficiais

- **Beginner's Guide** — https://nginx.org/en/docs/beginners_guide.html
- **Configuration File's Structure** — https://nginx.org/en/docs/beginners_guide.html#conf_structure
- **Starting, Stopping, and Reloading Configuration** — https://nginx.org/en/docs/beginners_guide.html#control
- **Serving Static Content** — https://nginx.org/en/docs/beginners_guide.html#static
- **Diretiva `location`** — https://nginx.org/en/docs/http/ngx_http_core_module.html#location
- **OCI — Security Lists** — https://docs.oracle.com/en-us/iaas/Content/Network/Concepts/securitylists.htm
- **OCI — Best Practices for Your Compute Instances** — https://docs.oracle.com/en-us/iaas/Content/Compute/References/bestpracticescompute.htm

---

## 3. Configuração anotada

### 3.0 Instalar o Nginx e liberar a porta 80

```bash
sudo apt install -y nginx
curl localhost
```

Esperado: a página "Welcome to nginx!". Ela vem do site `default` que o pacote
do Ubuntu já habilita — é ele que ocupa a porta 80.

```bash
sudo rm /etc/nginx/sites-enabled/default
sudo systemctl reload nginx
curl localhost
```

Esperado agora: erro de conexão ou resposta vazia. A porta 80 está livre.

Repare no que foi removido: apenas o **symlink** em `sites-enabled`. O arquivo
continua em `/etc/nginx/sites-available/default`, intacto. Recriar o symlink
traz o site de volta.

### 3.1 `/etc/nginx/sites-available/poc-api` — versão estática

Antes, criar o diretório e a página:

```bash
sudo mkdir -p /var/www/poc-api
```

`/var/www/poc-api/index.html`:

```html
<!doctype html>
<html lang="pt-BR">
  <head><meta charset="utf-8"><title>POC Nginx</title></head>
  <body>
    <h1>Nginx servindo estatico — POC</h1>
    <p>Se voce esta lendo isto pelo IP publico, a rede esta provada.</p>
  </body>
</html>
```

O conteúdo precisa ser identificável: quando essa página aparecer no navegador,
não pode restar dúvida se veio do seu `server` block ou de um cache, de um
default ou de outro site.

O `server` block, em `/etc/nginx/sites-available/poc-api`:

```nginx
server {
    listen 80 default_server;

    server_name _;

    root /var/www/poc-api;
    index index.html;

    location / {
        try_files $uri $uri/ =404;
    }
}
```

| Linha | O que faz |
|---|---|
| `server { ... }` | uma diretiva de bloco, no contexto `http`. Define um site |
| `listen 80 default_server` | escuta na porta 80. `default_server` marca este bloco como o que atende requisições cujo `Host` não casa com nenhum outro `server_name` — necessário porque você acessa por IP, sem nome de domínio |
| `server_name _` | `_` é um nome que nunca casa com um host real. Combinado com `default_server`, é a forma idiomática de dizer "este é o catch-all" |
| `root /var/www/poc-api` | diretório raiz. O caminho da URL é concatenado a ele: `/index.html` vira `/var/www/poc-api/index.html` |
| `index index.html` | qual arquivo servir quando a URL termina em `/` |
| `location / { ... }` | bloco que casa com todos os caminhos. É o mais curto possível, então perde para qualquer prefixo mais específico que você adicionar depois |
| `try_files $uri $uri/ =404` | tenta o caminho como arquivo, depois como diretório, e devolve 404 se nenhum existir. Sem ele, um caminho inexistente produz um erro menos claro |

Referências:
- `listen` — https://nginx.org/en/docs/http/ngx_http_core_module.html#listen
- `server_name` — https://nginx.org/en/docs/http/ngx_http_core_module.html#server_name
- `root` e `index` — https://nginx.org/en/docs/beginners_guide.html#static
- `location` — https://nginx.org/en/docs/http/ngx_http_core_module.html#location
- `try_files` — https://nginx.org/en/docs/http/ngx_http_core_module.html#try_files

Habilitar, testar a sintaxe e recarregar:

```bash
sudo ln -s /etc/nginx/sites-available/poc-api /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

| Comando | O que faz |
|---|---|
| `ln -s <origem> <destino>` | cria o symlink que habilita o site |
| `nginx -t` | testa a sintaxe **sem aplicar**. Esperado: `syntax is ok` e `test is successful` |
| `systemctl reload nginx` | aplica. Por baixo envia o mesmo sinal de `nginx -s reload`: sobe workers novos e deixa os antigos terminarem as requisições em curso |

Rode `nginx -t` antes de todo reload. Recarregar com sintaxe inválida é uma das
poucas formas de derrubar o serviço por descuido.

### 3.2 Ver a falha de fora — passo obrigatório

No Windows, **antes** de tocar em qualquer firewall:

```powershell
curl.exe --max-time 10 http://<ip-publico>
```

Esperado: **timeout**. O Nginx está correto — `curl localhost` já provou isso —
e o tráfego não chega. Ver esta falha agora, com a causa isolada e conhecida, é
o ponto central da estratégia deste plano.

`--max-time 10` evita esperar o timeout padrão sem saber se travou.

### 3.3 Camada 1 — regra de Ingress na Security List

Console da OCI: **Compute → Instances → sua instância → link da subnet →
Security List associada → Add Ingress Rules**.

| Campo | Valor | Por quê |
|---|---|---|
| Source Type | `CIDR` | a origem é uma faixa de endereços, não outro recurso da OCI |
| Source CIDR | `0.0.0.0/0` | qualquer origem — é um site público |
| IP Protocol | `TCP` | HTTP roda sobre TCP |
| Source Port Range | `All` | a porta de origem do cliente é aleatória; restringir aqui bloquearia todo mundo |
| Destination Port Range | `80` | a porta do Nginx |

A regra é *stateful*: a resposta sai automaticamente, sem regra de egress
correspondente.

Referência: https://docs.oracle.com/en-us/iaas/Content/Network/Concepts/securitylists.htm

**Teste de novo do Windows. Esperado: ainda timeout.** Não é erro seu — é a
camada 2 bloqueando. É exatamente aqui que a maioria conclui que a Security
List não funcionou e vai mexer no lugar errado.

### 3.4 Camada 2 — iptables

> **Atenção — risco de perda permanente de acesso à VM.** Esta seção altera as
> regras que também governam o SSH. Um erro derruba a conexão e a instância
> fica inacessível: não há desfazer, e a recuperação exige console serial da
> OCI ou recriar a VM do zero. Os três passos de proteção abaixo — backup,
> segunda sessão aberta e teste em terceira sessão — não são opcionais.

**Passo 1 — backup.**

```bash
sudo iptables-save > ~/iptables.backup
```

Despeja o conjunto de regras atual em um arquivo. É o que permite voltar atrás.

**Passo 2 — abrir uma segunda sessão SSH e deixá-la aberta.**

Em outro terminal do Windows, conecte de novo na VM. Mantenha **as duas**
abertas até o fim. Conexões já estabelecidas não são derrubadas por uma regra
nova — é essa sessão que restaura o backup se algo der errado.

**Passo 3 — localizar a linha do `REJECT`.**

```bash
sudo iptables -L INPUT --line-numbers
```

Saída, resumida:

```
Chain INPUT (policy ACCEPT)
num  target     prot opt source     destination
1    ACCEPT     all  --  anywhere   anywhere     state RELATED,ESTABLISHED
2    ACCEPT     icmp --  anywhere   anywhere
3    ACCEPT     all  --  anywhere   anywhere
4    ACCEPT     udp  --  anywhere   anywhere     udp spt:ntp
5    ACCEPT     tcp  --  anywhere   anywhere     state NEW tcp dpt:ssh
6    REJECT     all  --  anywhere   anywhere     reject-with icmp-host-prohibited
```

Anote o número da linha `REJECT` — no exemplo, `6`. **Confira na sua VM; o
número varia conforme a imagem.**

Repare na linha 5: é ela que libera o SSH. Não pode ser removida, alterada, nem
acabar depois do `REJECT`.

**Passo 4 — inserir a regra antes do `REJECT`.**

Substituindo `<N>` pelo número que você anotou:

```bash
sudo iptables -I INPUT <N> -m state --state NEW -p tcp --dport 80 -j ACCEPT
```

| Trecho | O que faz |
|---|---|
| `-I INPUT <N>` | *insert* na posição `N` da chain `INPUT`, empurrando o `REJECT` para baixo. **`-A` acrescentaria ao final, depois do `REJECT`, e não teria efeito nenhum** |
| `-m state --state NEW` | casa apenas conexões novas. As já estabelecidas são cobertas pela regra 1 |
| `-p tcp --dport 80` | protocolo TCP, porta de destino 80 |
| `-j ACCEPT` | ação: aceitar |

Referência, seção "Essential Firewall Rules":
https://docs.oracle.com/en-us/iaas/Content/Compute/References/bestpracticescompute.htm

**Passo 5 — verificar o SSH antes de qualquer outra coisa.**

Abra uma **terceira** sessão SSH. Se conectar, o acesso está preservado.

Se não conectar, restaure imediatamente pela sessão que ainda está aberta:

```bash
sudo iptables-restore < ~/iptables.backup
```

**Passo 6 — validar o acesso externo.** No Windows:

```powershell
curl.exe http://<ip-publico>
```

Esperado: o `index.html`. **Rede provada.** Daqui em diante, falha de acesso
externo é problema de configuração do Nginx.

**Passo 7 — persistir.**

```bash
sudo netfilter-persistent save
```

Grava as regras em `/etc/iptables/rules.v4`. Sem isso, elas vivem só em memória
e desaparecem no próximo boot — a POC "para de funcionar sozinha" dias depois,
desconectada da causa.

**Passo 8 — confirmar com um reboot.**

```bash
sudo reboot
```

Reconecte após alguns minutos e repita o Passo 6. Confirme também que o
container voltou sozinho:

```bash
docker ps
curl localhost:8080/health
```

É o `--restart unless-stopped` da Tarefa 4 que faz isso acontecer.

### 3.5 Versionar a cópia do config

Copie o conteúdo de `/etc/nginx/sites-available/poc-api` para
`nginx/poc-api.conf` no repositório, e commite. A cópia é manual de propósito:
automatizar o deploy esconderia justamente o que se quer aprender.

---

## 4. Como validar

Na VM, após a Tarefa 5:

```bash
curl localhost
```

Esperado: o conteúdo do seu `index.html`.

No Windows, após a Tarefa 5 (antes do firewall):

```bash
curl.exe --max-time 10 http://<ip-publico>
```

Esperado: **timeout**. Falha esperada, causa conhecida.

No Windows, após a Tarefa 6 completa:

```bash
curl.exe http://<ip-publico>
```

Esperado: o conteúdo do `index.html`. **Rede provada.**

Depois de `sudo reboot`, repetir o último comando. Mesmo resultado confirma que
a regra foi persistida.

---

## 5. Armadilhas

**O site default ocupa a porta 80.**
Instalar o Nginx já coloca um site no ar. Seu `server` block novo entra em
conflito ou nunca é escolhido. Remover o symlink de `sites-enabled` resolve — o
arquivo em `sites-available` pode ficar onde está.

**`iptables -A` em vez de `-I`.**
A regra vai para depois do `REJECT`, aparece na listagem e não surte efeito.
Erro difícil justamente porque a evidência visual diz que está certo.

**Não conferir o número da linha do `REJECT`.**
O número varia conforme a imagem. Copiar um `-I INPUT 6` de um tutorial sem
listar as regras antes pode inserir no lugar errado — inclusive antes da regra
do SSH, o que muda o comportamento de forma silenciosa.

**Usar `ufw`.**
Derruba o SSH. A Oracle desaconselha explicitamente nestas imagens.

**Esquecer o `netfilter-persistent save`.**
Tudo funciona até o próximo reboot, e a falha aparece dias depois, desconectada
da causa.

**Testar só com `curl localhost` na VM.**
Passa mesmo com o firewall inteiramente fechado, porque o tráfego nem chega à
chain `INPUT`. Só o teste feito do Windows prova rede. É o erro que faz um
iniciante concluir que terminou.

**`curl` no PowerShell.**
Alias de `Invoke-WebRequest`. Use `curl.exe`. E use `--max-time`, ou você fica
esperando o timeout padrão sem saber se travou.

**Recarregar sem `nginx -t`.**
Sintaxe inválida derruba o serviço no reload. `nginx -t` custa um segundo.

---

**Anterior:** [`01-api-nestjs-docker.md`](01-api-nestjs-docker.md)
**Próximo:** [`02b-proxy-reverso.md`](02b-proxy-reverso.md)
