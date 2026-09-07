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

## 3. Exercício

### Parte A — Nginx servindo estático (Tarefa 5)

1. Instalar o Nginx e ver a página default que já sobe sozinha na porta 80.
2. Desabilitar o site default removendo o symlink de `sites-enabled` — e
   confirmar que o arquivo continua em `sites-available`.
3. Criar `/var/www/poc-api/index.html` com um conteúdo identificável.
4. Escrever o `server` block em `/etc/nginx/sites-available/poc-api`:
   escuta na 80, serve `/var/www/poc-api`, entrega o `index.html` em `/`.
5. Habilitar o site com um symlink, rodar `nginx -t`, recarregar.
6. Validar com `curl localhost`.
7. Tentar de fora e **ver falhar** — este passo não é opcional.
8. Copiar o config para `nginx/poc-api.conf` no repositório e commitar.

### Parte B — as duas camadas de firewall (Tarefa 6)

9. Registrar o estado "antes" com um `curl.exe` do Windows (timeout).
10. Adicionar a regra de Ingress na Security List: `CIDR`, `0.0.0.0/0`, `TCP`,
    Source Port `All`, Destination Port `80`.
11. Testar de novo — **ainda deve falhar**. É a camada 2 bloqueando.
12. Fazer backup do iptables.
13. Abrir uma segunda sessão SSH e mantê-la aberta.
14. Localizar o número da linha do `REJECT`.
15. Inserir a regra da porta 80 **antes** dela, com `-I`.
16. Testar o SSH numa terceira sessão antes de qualquer outra coisa.
17. Validar o acesso externo — deve entregar o `index.html`.
18. Persistir com `netfilter-persistent save` e confirmar com um reboot.

> **Atenção.** Os passos 12, 13 e 16 existem para tornar reversível um erro que,
> sem eles, custa a instância inteira. Um iptables mal editado derruba o SSH
> permanentemente, e a única recuperação é console serial da OCI ou recriar a
> VM do zero. Nenhum dos três é opcional.

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
