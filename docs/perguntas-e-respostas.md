# Perguntas e respostas — POC Nginx

Todas as dúvidas que surgiram durante a execução — a POC (Fases 0 a 2B) e os
itens 1 e 2 do backlog, `server_name` real e TLS — com as respostas.

Duas origens, marcadas em cada pergunta:

- **[dúvida]** — surgiu na hora de executar
- **[revisão]** — pergunta de revisão conceitual no fim de cada tarefa

Ordenado por tema, não por cronologia. Para a sequência do que foi feito, ver
[`passo-a-passo.md`](passo-a-passo.md).

---

## Rede e OCI

### O que colar no campo IPv4 CIDR Block ao criar a VCN? **[dúvida]**

`10.0.0.0/16` para a VCN, `10.0.0.0/24` para a subnet pública.

CIDR é a faixa de endereços **privados** que existem dentro da VCN. Nada disso
é endereço de internet — o IP público da instância vem separado, atribuído pela
Oracle e mapeado por NAT.

Lendo `10.0.0.0/16`: os primeiros 16 bits (`10.0`) são fixos, o resto varia.
São 65.536 endereços, de `10.0.0.0` a `10.0.255.255`. A subnet `/24` pega 256
deles; a OCI reserva os dois primeiros e o último, sobram 253 utilizáveis.

As faixas privadas válidas são `10.0.0.0/8`, `172.16.0.0/12` e
`192.168.0.0/16`. O `10.x` é convenção em nuvem por ser a maior.

**Quando o valor importaria:** apenas se a VCN fosse conectada a outra rede —
outra VCN, ou a rede de uma empresa por VPN. Faixas iguais dos dois lados
colidem e o roteamento quebra. Em rede isolada, qualquer faixa privada serve.

### Se eu puser o IP público da minha máquina na regra de rota, só o meu computador falaria com a VM? **[dúvida]**

Não, e o efeito colateral seria grave.

Route table e Security List respondem perguntas diferentes:

| Peça | Pergunta que responde | Direção |
|---|---|---|
| Route table | "pacote com destino X sai por onde?" | **saída** da subnet |
| Security List | "quem tem permissão de falar comigo?" | entrada e saída |

O `Destination CIDR Block` é o destino do pacote que **sai**, não a origem de
quem entra. Com o seu IP ali, a VM só teria rota até a sua casa — `github.com`,
`get.docker.com` e os repositórios do `apt` ficariam inalcançáveis. `git clone`,
`apt update` e `docker build` parariam de funcionar.

**A parte curiosa:** o acesso externo *pareceria* funcionar só para você, mas
por acidente. O pacote de qualquer pessoa chegaria normalmente (a entrada usa
roteamento implícito); o que travaria é a **resposta**, sem rota de volta.
Resultado certo, mecanismo errado.

A ferramenta correta para restringir origem é a Security List, com uma regra de
ingress e `Source CIDR` = `<seu-ip>/32` — `/32` significa "exatamente este
endereço". É boa prática real para SSH, com a ressalva de que IP residencial é
dinâmico: quando mudar, você perde acesso à VM.

### O que são ingress e egress? **[dúvida]**

Ponto de vista da subnet:

- **Ingress** — tráfego **entrando**: quem, de fora, pode falar comigo e em
  qual porta.
- **Egress** — tráfego **saindo**: com quem eu posso falar.

O padrão da OCI: ingress só na porta 22, egress liberado para tudo. A VM baixa
pacotes, e o mundo não bate em qualquer porta dela.

**Regras são stateful.** Se o ingress permite a entrada de uma conexão, a
resposta sai automaticamente — você não escreve regra em par. Por isso a POC
adicionou uma regra de ingress para a porta 80 e nenhuma de egress.

### Qual a diferença entre as portas 22, 80 e 443? **[dúvida]**

Uma máquina tem um IP e roda vários serviços. A porta é o número que diz a qual
serviço o pacote se destina. `129.159.50.172:22` e `129.159.50.172:80` são o
mesmo computador, serviços diferentes.

| Porta | Serviço | O que é |
|---|---|---|
| 22 | SSH | terminal remoto criptografado; é como a VM é administrada |
| 80 | HTTP | web em texto claro — quem estiver no caminho lê o tráfego |
| 443 | HTTPS | o mesmo HTTP, dentro de TLS, criptografado |

Os números são convenção — o registro de *well-known ports* da IANA. Nada
impede rodar um site na 8080; só que todo mundo precisaria digitar a porta,
porque o navegador assume 80 para `http://` e 443 para `https://`.

### A seção "Security" do formulário da instância — marco alguma coisa? **[dúvida]**

Não. Deixe tudo desmarcado.

Ela contém *Shielded Instance* (Secure Boot, Measured Boot, TPM) e
*Confidential Computing* — proteções de firmware e de memória, disponíveis
apenas em shapes maiores. No `E2.1.Micro` costumam aparecer indisponíveis.

**Nenhuma tem relação com rede.** Quem controla quem fala com a VM é a Security
List da subnet mais o iptables. O nome da seção engana.

### O que é VNIC name? **[dúvida]**

*Virtual Network Interface Card* — a placa de rede virtual da instância. É ela
que vive na subnet, carrega o IP privado e é o ponto onde as security lists são
aplicadas.

O campo `VNIC name` é apenas um rótulo, opcional. `Private IPv4 address` em
branco deixa a OCI atribuir automaticamente. `Use network security groups`
desmarcado: NSG é uma alternativa à Security List, aplicada por VNIC em vez de
por subnet.

**Consequência que evita confusão depois:** o IP público **não existe dentro do
Ubuntu**. É NAT feito pela OCI sobre o IP privado da VNIC. `ip addr show` mostra
`10.0.0.215` e nada mais — comportamento correto, não falha de atribuição.

### O caminho Instância → subnet → Security List não é mais confuso que ir pela VCN? **[dúvida]**

É. Ir por **Networking → VCNs → Subnets → Security Lists** é mais direto.

O caminho pela instância vem do plano original, que assumia não se saber qual
subnet a instância usa — daí partir dela para descobrir. Sabendo o nome da
subnet, não há motivo para o desvio.

### Se a instância estivesse na subnet privada, o que aconteceria? **[revisão]**

Você perceberia **antes** do SSH: em subnet privada o campo *Assign a public
IPv4 address* nem aparece no formulário. Quem não sabe que ele deveria estar lá
cria a instância normalmente e só descobre na hora de conectar.

**Como se conecta a uma VM em subnet privada:**

| Caminho | Como funciona |
|---|---|
| Bastion host | uma segunda VM, pequena, na subnet pública. Você entra nela e dela salta para a privada. Só o bastion fica exposto |
| OCI Bastion (gerenciado) | a Oracle mantém o bastion; você cria uma sessão temporária e ela abre um túnel SSH |
| VPN / FastConnect | liga sua rede local à VCN; a subnet privada passa a ser alcançável como rede interna |
| Instance Console Connection | console serial, funciona independente de rede. Último recurso — e o que salvaria de um iptables mal configurado |

O padrão em produção é esse: banco e aplicação na privada, um único ponto de
entrada exposto. A POC usa subnet pública porque o objetivo é expor a API.

---

## Firewall — as duas camadas

### Por que a Security List sozinha não abre a porta?

Porque existem duas camadas independentes, e o pacote atravessa as duas:

```
internet → Security List (OCI, fora da VM) → iptables (dentro da VM) → Nginx
```

A imagem Ubuntu da Oracle **já vem com regras de iptables ativas**, liberando
praticamente só a porta 22. Isso surpreende quem espera uma máquina limpa: você
não instalou firewall nenhum, e há um firewall.

### As duas camadas produzem sintomas diferentes?

**Não.** Nas duas o sintoma é `timeout`.

Isso contraria a mecânica: a Security List **descarta** o pacote em silêncio,
enquanto o iptables da imagem nega com `REJECT --reject-with
icmp-host-prohibited`, que **responde** com um erro ICMP — em tese,
`No route to host` no cliente.

Na prática esse ICMP não chega. Verificado nesta POC: com a Security List
aberta e o iptables fechado, o cliente continuou vendo `timeout`. O erro é
filtrado no caminho de volta.

**O que distingue de verdade** é olhar se o pacote chega, na VM:

```bash
sudo tcpdump -ni ens3 tcp port 80
```

| O que aparece | Conclusão |
|---|---|
| linhas `Flags [S]` do seu IP | o pacote chega — a Security List está aberta, quem nega é o iptables |
| silêncio | o pacote não chega — a Security List ainda bloqueia |

Essa evidência não depende de o ICMP sobreviver ao retorno.

### O que aconteceria com `iptables -A` em vez de `-I`? **[revisão]**

A regra seria criada, apareceria normalmente em `iptables -L`, e **não teria
efeito nenhum**.

```
4    ACCEPT  6  --  state NEW tcp dpt:22
5    REJECT  0  --  reject-with icmp-host-prohibited
6    ACCEPT  6  --  state NEW tcp dpt:80      ← a regra, aqui embaixo
```

O iptables avalia de cima para baixo e **para na primeira regra que casa**. A
regra do `REJECT` casa com qualquer pacote — `all -- 0.0.0.0/0 0.0.0.0/0`, sem
condição. Nada sobrevive até a linha 6.

O erro é caro pela contradição entre evidência e comportamento: você lista as
regras, vê a porta 80 liberada, conclui que o firewall está certo, e vai caçar
o problema no Nginx — onde não há problema.

Por isso: `-I INPUT <N>` com o número conferido em
`sudo iptables -L INPUT -n --line-numbers`, nunca um número copiado de tutorial.

### Por que a Oracle desaconselha `ufw` nessas imagens? **[revisão]**

Porque o `ufw` não acrescenta regras ao que existe — ele **gerencia o conjunto
inteiro**: cria chains próprias, limpa a `INPUT` e instala a política dele.

A regra que libera a porta 22 foi posta pela imagem da Oracle. O `ufw` não a
conhece. No `ufw enable`:

1. a `INPUT` é reescrita com as chains do `ufw`
2. a política padrão de entrada vira `deny`
3. só passa o que estiver nas regras **do ufw** — e a 22 não está lá

Resultado: porta 22 fechada. A sessão atual sobrevive, porque casa com a regra
de estado `ESTABLISHED`, mas **nenhuma conexão nova entra**. Você descobre ao
fechar o terminal, e aí não tem volta.

Existe o caminho seguro (`ufw allow 22` antes do `enable`), e ainda assim dois
gerenciadores editando a mesma tabela produzem um conjunto que nenhum dos dois
modela direito: `netfilter-persistent save` gravaria as chains do `ufw`, e um
`ufw reload` apagaria regras feitas à mão. Escolha um.

### Por que a regra some depois do reboot?

Regras de iptables vivem em memória. No boot, o sistema restaura o conteúdo de
`/etc/iptables/rules.v4`. Gravar exige:

```bash
sudo netfilter-persistent save
```

Sem isso, a POC "para de funcionar sozinha" dias depois, desconectada da causa.

---

## Docker e rede de container

### O que significa `127.0.0.1`? **[dúvida]**

Endereço de **loopback**: "esta máquina, falando com ela mesma". O tráfego nunca
sai pela placa de rede — o sistema devolve o pacote para dentro da própria
pilha.

Toda máquina tem um. Quando um processo abre um socket, ele escolhe em qual
interface escutar:

| Bind | Quem alcança |
|---|---|
| `127.0.0.1` | só processos da mesma máquina |
| `10.0.0.215` | só quem chega por aquela interface |
| `0.0.0.0` | todas as interfaces — é um curinga, não um endereço |

### Por que `app.listen(8080)` funciona no Windows e falharia no container? **[revisão]**

Porque o container tem *network namespace* próprio — pilha de rede inteira
separada, com **loopback próprio**.

```
┌─ VM (host) ────────────────────────────┐
│  lo   127.0.0.1                        │
│  ens3 10.0.0.215                       │
│                                        │
│  ┌─ container ──────────────────┐      │
│  │  lo   127.0.0.1  ← OUTRO     │      │
│  │  eth0 172.17.0.2             │      │
│  └──────────────────────────────┘      │
└────────────────────────────────────────┘
```

Dois `127.0.0.1` diferentes — não é o mesmo endereço em lugares diferentes, são
máquinas diferentes falando consigo mesmas.

`app.listen(8080)` sem host faz o Nest escutar só no loopback **do container**.
O Docker entrega o tráfego da porta publicada pela `eth0`, nunca pela `lo` dele:
socket preso ao loopback não enxerga nada vindo de fora.

No Windows funcionava porque a aplicação e o `curl.exe` rodavam na mesma
máquina — cliente e servidor no mesmo loopback.

### `0.0.0.0` no `listen` e `127.0.0.1` no `-p` não se contradizem?

Não. São dois limites diferentes, em duas máquinas diferentes:

```
-p 127.0.0.1:8080:8080     ← loopback do HOST (a VM)
app.listen(8080,'0.0.0.0') ← todas as interfaces do CONTAINER
```

O primeiro (do container) precisa ser aberto, senão o Docker não consegue
entregar. O segundo (do host) precisa ser restrito, senão a API ganha porta
própria na internet.

### O que `-p` faz de verdade, e por que o prefixo `127.0.0.1:` importa? **[revisão]**

Três cenários:

| Comando | Onde a porta aparece | Quem alcança |
|---|---|---|
| sem `-p` | só na bridge do Docker (`172.17.0.x`) | outros containers; nem o host |
| `-p 127.0.0.1:8080:8080` | loopback do host | processos dentro da VM — o Nginx |
| `-p 8080:8080` | **todas as interfaces do host** | quem chegar por `ens3` |

O Docker publica portas escrevendo regras de **DNAT na tabela `nat`, em
`PREROUTING`**, e o tráfego resultante segue pela chain `FORWARD` até o
container — **nunca passa pela `INPUT`**.

Consequência: **o firewall da VM não protege porta publicada por container.**
Aquela regra `REJECT` no fim da `INPUT` não vale para a porta 8080.

Com `-p 8080:8080`, o placar seria:

| Camada | Protegeria? |
|---|---|
| Security List (OCI) | sim — é externa à VM, o Docker não a alcança |
| iptables da VM | **não** — o Docker passa por fora da `INPUT` |

Ou seja: uma camada só, configurada num console web, sem nada dentro da máquina
reclamando. E o erro seria invisível — tudo continuaria funcionando pelo Nginx,
nenhum teste falharia.

Para filtrar tráfego de container com iptables existe a chain `DOCKER-USER`,
avaliada antes das regras geradas pelo Docker. Fora do escopo desta POC, que
resolve prendendo no loopback.

### Por que o container vê `172.17.0.1` e não `127.0.0.1`?

Porque já existe um proxy no caminho, antes do Nginx entrar.

```
curl (VM) ──> 127.0.0.1:8080 ──> docker-proxy ──> 172.17.0.2:8080 (container)
              └─ conexão 1 ─┘                 └─ conexão 2 ─┘
```

O `docker-proxy` — o processo que aparece segurando o socket em `ss` — não
repassa a conexão original: abre uma **nova** até o container, saindo pela
bridge `docker0`. Da perspectiva do container, quem chamou foi `172.17.0.1`,
o lado do host nessa bridge.

Com dois saltos no caminho, o endereço do socket **nunca** revela o cliente
real. Header é a única via.

### O que impede `http://<ip-publico>:8080` de funcionar? **[revisão]**

Duas coisas independentes:

- **Security List** — não há regra de ingress para 8080; o pacote é descartado
  fora da VM.
- **Bind do container** — o socket está em `127.0.0.1:8080`, não em
  `10.0.0.215:8080`. Nada escuta na interface externa.

Removendo só uma:

| Remove | O que acontece | Sintoma |
|---|---|---|
| só a Security List | o pacote chega, ninguém escuta, o kernel responde RST | `Connection refused` |
| só o bind (`-p 8080:8080`) | socket aberto em tudo, mas o pacote não chega | `timeout` |

Nos dois casos ainda bloqueado — o que muda é a margem. Remover o bind é o erro
perigoso, porque deixa uma camada só, e o iptables **não** cobre essa porta.

---

## Nginx

### Diretiva simples, diretiva de bloco, contexto

**Diretiva simples** termina em ponto e vírgula: `worker_processes auto;`

**Diretiva de bloco** termina em chaves com outras diretivas dentro. Um bloco
que contém diretivas é um **contexto**.

| Contexto | Onde fica | O que governa |
|---|---|---|
| `main` | fora de qualquer bloco | processo do Nginx: usuário, workers, PID |
| `http` | dentro do `main` | tráfego HTTP: logs, tipos MIME, timeouts |
| `server` | dentro do `http` | um site: porta, nome de host |
| `location` | dentro do `server` | caminhos de URL dentro daquele site |

### Se eu mover `root` para dentro do `location`, muda alguma coisa? E `try_files` para o `server`? **[revisão]**

Duas regras respondem:

1. **Cada diretiva tem uma lista de contextos permitidos**, publicada na
   documentação. `root` aceita `http`, `server` e `location`. `try_files` aceita
   `server` e `location`. `listen` só aceita `server`.
2. **O que é definido fora é herdado dentro**, salvo se redefinido.

**`root` dentro do `location /`** — nada muda. Definido no `server`, já é
herdado por todos os `location`. Com um `location` só, dá no mesmo. Passaria a
importar com vários: `root` no `server` vira o padrão, e cada `location` pode
sobrescrever.

**`try_files` no `server`** — é permitido, mas muda **quando** ele roda. No
`location`, é avaliado depois da escolha do `location`. No `server`, roda antes
disso, em fase anterior. Em configuração simples o resultado é parecido;
misturado com vários `location`, fica difícil de prever.

Regra prática: `listen` e `server_name` identificam o site e vão no `server`.
Regras de "o que fazer com este caminho" vão no `location`.

### Como o Nginx escolhe o `location`?

Para cada requisição, escolhe primeiro o `server` (pela porta e pelo `Host`) e
depois **um único** `location`:

1. prefixos são comparados; o **mais longo** que casa é o candidato
2. expressões regulares são testadas na ordem em que aparecem; a primeira que
   casa vence sobre o candidato por prefixo
3. `location /` casa com tudo e é o mais curto — funciona como fallback

Um `location` mais específico ganha do genérico independentemente da ordem em
que foram escritos.

### Qual a diferença entre `reload`, `quit` e `stop`? **[revisão]**

| Comando | O que faz |
|---|---|
| `nginx -s reload` | troca a configuração, mantém o serviço no ar |
| `nginx -s quit` | desligamento educado: para de aceitar, termina o que está em curso, encerra |
| `nginx -s stop` | desliga imediato, cortando conexões em andamento |
| `nginx -t` | testa a sintaxe sem aplicar |

**O mecanismo do reload.** O Nginx roda como um processo mestre e vários
workers:

```
antes:    master ──> workers antigos (configuração antiga)
reload:   master ──> workers NOVOS   (configuração nova)  ← atendem o que chega agora
                 └─> workers antigos ← terminam o que já estava em curso e morrem
```

O mestre permanece. Nenhuma requisição em andamento é cortada, e não há janela
de indisponibilidade. É esse o motivo de o comando existir.

Duas confusões comuns:

- **A configuração é recarregada inteira, sempre.** Não existe recarga seletiva
  por site ou por tenant.
- **`quit` não é "reiniciar".** É o desligamento gracioso. Quem corta conexão é
  o `stop`.

### `systemctl reload nginx` é diferente de `nginx -s reload`?

Não. A unidade do systemd define `ExecReload` apontando para `nginx -s reload`.
Mesmo mecanismo, invólucro diferente.

Quem reinicia o processo do zero é `systemctl restart` — esse sim distinto.

### Recarregar com configuração inválida derruba o Nginx?

**Não.** O mestre testa a configuração nova antes de aplicá-la; se estiver
inválida, registra o erro no log e **continua rodando com a antiga**.

O risco é outro e pior de diagnosticar: sua mudança simplesmente não é
aplicada. O comando volta sem erro visível, você testa e encontra o
comportamento antigo, e vai depurar uma configuração correta que nunca foi
carregada.

Quem cai com configuração inválida é `systemctl restart`.

**É por isso que `nginx -t` é útil** — não para evitar queda, mas para
transformar falha silenciosa em erro visível.

### Por que existem `sites-available` e `sites-enabled` se a documentação do nginx.org não menciona?

Porque são convenção de empacotamento do Debian/Ubuntu, não do Nginx.

- **`sites-available/`** — todos os sites que existem na máquina, ativos ou não
- **`sites-enabled/`** — apenas symlinks para os que devem estar no ar

O `nginx.conf` do pacote inclui `sites-enabled/*`. Habilitar é criar o symlink;
desabilitar é removê-lo — o arquivo de configuração continua existindo nos dois
casos.

O Nginx compilado do código-fonte não tem essas pastas; costuma usar `conf.d/`.
Nenhuma é "a certa". Saber disso resolve boa parte da confusão de quem segue a
documentação oficial e um tutorial de Ubuntu ao mesmo tempo.

### Por que a barra final no `proxy_pass` importa? **[dúvida]**

Chega a requisição `GET /api/health`. O Nginx escolhe o `location /api/`, e o
caminho fica dividido:

```
/api/health
└──┬─┘└──┬─┘
   │     └─ o resto:   health
   └─ o que casou:     /api/
```

Agora ele precisa decidir **qual caminho enviar para a aplicação**, e a regra é
uma só: **tem caminho depois da porta?**

**Sem caminho** — `http://127.0.0.1:8080` termina na porta.
"Não recebi instrução de caminho; encaminho o URI original inteiro."
→ envia `/api/health`

**Com caminho** — `http://127.0.0.1:8080/` tem um `/` depois da porta.
"Recebi um caminho; substituo a parte que casou por ele e mantenho o resto."
→ substitui `/api/` por `/`, mantém `health` → envia `/health`

| `proxy_pass` | Tem caminho? | Chega na aplicação |
|---|---|---|
| `http://127.0.0.1:8080` | não | `/api/health` |
| `http://127.0.0.1:8080/` | sim, `/` | `/health` |
| `http://127.0.0.1:8080/v2/` | sim, `/v2/` | `/v2/health` |

A terceira linha mostra que não é sobre a barra em si — é sobre existir um
caminho. A barra sozinha é o caminho mais curto possível.

**Evidência, medida na execução.** Mesma URL, mesmo cliente, um caractere de
diferença na configuração:

```
proxy_pass http://127.0.0.1:8080;   →  GET /api/health   | x-real-ip=177.16.235.121
proxy_pass http://127.0.0.1:8080/;  →  GET /health       | x-real-ip=177.16.235.121
```

Os headers idênticos confirmam que só o caminho mudou.

Sem a barra, o 404 vem **do Nest**, em JSON; com a configuração estática vinha
do Nginx, em HTML. A assinatura da resposta já diz quem respondeu.

**Por que isso não aparece com `location /`:** o prefixo casado é `/`, e
substituí-lo por `/` não muda nada. As duas formas são equivalentes enquanto
não houver prefixo a remover.

### Onde colocar o bloco catch-all? **[dúvida]**

No mesmo arquivo, depois do bloco nomeado. `nginx/poc-api.conf` continua sendo
a unidade versionada, e os dois blocos são a configuração daquela porta.

**A ordem no arquivo não decide nada.** O Nginx compara o header `Host` contra
os `server_name` de todos os blocos daquela porta; se nenhum casar, usa o
marcado `default_server`. Não é "o primeiro que aparece".

Separar o catch-all em arquivo próprio também é defensável — é uma preocupação
da porta, não do site. Para um repositório com um arquivo versionado, junto é
mais simples de acompanhar.

### `a duplicate default server for 0.0.0.0:80`

Só **um** bloco por porta pode carregar a marca `default_server`. Ao criar o
catch-all sem remover a marca do bloco nomeado, o Nginx recusa a configuração:

```
[emerg] a duplicate default server for 0.0.0.0:80 in /etc/nginx/sites-enabled/poc-api:21
```

O erro é reportado na **segunda** ocorrência — a linha citada é a do bloco novo,
não a do antigo.

O `systemctl reload` seguinte falha com `Job for nginx.service failed`, e **o
Nginx continua no ar** com a configuração antiga. A mensagem do systemd relata
que o `ExecReload` retornou erro, não que o serviço morreu.

### Por que `X-Real-IP` e `X-Forwarded-For` existem os dois?

Numa conexão através de proxy, quem faz a requisição para a aplicação é o
proxy. O IP de origem que a API enxerga é o do proxy, e o header `Host` é o do
destino do encaminhamento.

| Header | O que carrega |
|---|---|
| `Host` | o host que o cliente pediu originalmente |
| `X-Real-IP` | o IP do cliente, valor único e direto. Convenção do Nginx |
| `X-Forwarded-For` | a **cadeia** de proxies, separada por vírgulas. Padrão de fato da indústria |

`X-Forwarded-For` existe porque, na vida real, pode haver mais de um proxy no
caminho — CDN, balanceador, e só então o seu Nginx. Cada um acrescenta o
endereço que enxergou.

**A armadilha:** preencher `X-Forwarded-For` com `$remote_addr` faz o valor ser
**substituído** a cada salto, e o header deixa de ser uma cadeia. A variável
correta é `$proxy_add_x_forwarded_for`, que devolve o header que já chegou com
`$remote_addr` anexado ao final.

### Sem os `proxy_set_header`, o que quebra?

Nada visível — e é isso que torna a falha perigosa. A API responde, os testes
passam, o `curl` funciona.

O que se perde: log de acesso inútil (todos os registros com o mesmo IP), rate
limiting por IP impossível, bloqueio por origem impossível, e qualquer URL que
a aplicação gere para si mesma sai apontando para o endereço errado.

### O que precisaria mudar para servir HTTPS na porta 443? **[revisão]**

Três camadas:

**Security List** — regra de ingress: `CIDR`, `0.0.0.0/0`, `TCP`, destino `443`.

**iptables** — mesma operação da porta 80, conferindo o número da linha do
`REJECT` antes:

```bash
sudo iptables -I INPUT <N> -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

**Nginx** — um `server` block com TLS, mais um bloco na 80 redirecionando:

```nginx
listen 443 ssl;
ssl_certificate     /caminho/fullchain.pem;
ssl_certificate_key /caminho/privkey.pem;
```

E aí `proxy_set_header X-Forwarded-Proto $scheme` passa a fazer sentido: conta
à aplicação se o cliente veio por HTTP ou HTTPS.

**O que impedia: faltava um domínio.** Certificado é emitido para um **nome**,
não para um IP. A autoridade certificadora precisa verificar que você controla
aquele nome; com IP puro não há o que validar. Um certificado autoassinado
funciona tecnicamente, mas todo navegador mostra tela de aviso.

O bloqueio não era técnico do lado do Nginx — era de identidade. Resolvido com
um subdomínio DuckDNS; ver a seção seguinte.

---

## TLS e certificados

### GitHub Pages serve como domínio? **[dúvida]**

Não. Ele dá um nome — `usuario.github.io` — mas apontando para os servidores do
GitHub, e o DNS dele não é seu. Não há como fazer esse nome resolver para o IP
da sua VM.

Pages hospeda conteúdo estático na infraestrutura do GitHub. Usar domínio
customizado nele é possível, mas exige já ter um domínio — a mesma dependência
que se queria evitar.

### Como conseguir um nome de host sem registrar domínio?

| Opção | Como funciona | TLS depois |
|---|---|---|
| **nip.io / sslip.io** | `129-159-50-172.nip.io` resolve para o IP embutido no próprio nome. Zero cadastro | cota do Let's Encrypt pode apertar |
| **DuckDNS** | cadastro rápido, você escolhe `algo.duckdns.org` e aponta para o seu IP. DNS real e editável | funciona bem — `duckdns.org` está na Public Suffix List, então cada subdomínio tem cota própria |
| **Domínio próprio** | registrar e criar um registro A | sem ressalva |

Esta POC usou DuckDNS: `lcnsilva.duckdns.org`.

"Resposta não autoritativa" no `nslookup` é normal — significa que a resposta
veio do cache do resolvedor, não do servidor autoritativo do domínio.

### `certonly` ou `--nginx`?

| Modo | O que faz |
|---|---|
| `certbot --nginx` | emite o certificado **e reescreve** o seu arquivo: adiciona `listen 443 ssl`, os caminhos do certificado e um bloco de redirecionamento |
| `certbot certonly` | apenas emite e renova. A configuração do Nginx fica por sua conta |

Esta POC usou `certonly`, coerente com o objetivo de ver o que a automação
normalmente esconde.

### Como o Let's Encrypt verifica que o domínio é seu?

Pelo desafio HTTP-01: a autoridade emite um desafio, o certbot publica um
arquivo em `/.well-known/acme-challenge/`, e o servidor dela busca esse arquivo
pelo seu domínio, na **porta 80**. Servir o arquivo prova controle sobre o nome.

Por isso o comando usa `--webroot`, apontando para o diretório que o Nginx já
serve:

```bash
sudo certbot certonly --webroot -w /var/www/poc-api \
  -d lcnsilva.duckdns.org \
  --deploy-hook "systemctl reload nginx"
```

Sem plugin, e sem o certbot tocar na configuração.

`--dry-run` antes da emissão real usa o ambiente de teste: o Let's Encrypt tem
cota, e queimar tentativa com erro de digitação é chato.

### Para que serve o `--deploy-hook`?

No modo `certonly`, o certbot renova sozinho a cada ~60 dias, mas **não sabe que
o Nginx precisa reler o arquivo novo**. Sem o hook, o certificado é renovado e o
Nginx segue servindo o vencido até alguém reiniciar o serviço por outro motivo.

Verificação do ciclo completo, contra o ambiente de teste:

```bash
sudo certbot renew --dry-run
```

### Por que o bloco da porta 80 não pode ser removido?

Duas funções, as duas ainda necessárias:

1. servir `/.well-known/acme-challenge/` — a **renovação** usa o mesmo desafio,
   para sempre
2. redirecionar o resto com `301` para HTTPS

O `location` do desafio vence o `location /` por ser prefixo mais longo,
independente da ordem no arquivo.

### Para que serve testar `curl -k https://<ip>`? **[dúvida]**

Para verificar que o catch-all cobre **TLS também**, não só HTTP.

Sem um bloco catch-all na 443, o Nginx elegeria algum bloco como padrão daquela
porta — e o único candidato seria o nomeado. Resultado: quem se conectasse por
IP receberia o certificado de `lcnsilva.duckdns.org` **antes** de qualquer
verificação de `Host`, e o site seria servido a qualquer sonda.

Com `ssl_reject_handshake on`, o resultado esperado é erro de handshake:

```
curl: (35) schannel: ... fatal SSL/TLS alert received
```

O `-k` desliga a *validação* do certificado e não ajuda, porque não há
certificado a validar: a diretiva aborta a negociação antes disso. O servidor se
recusa a apresentar identidade.

**Ressalva honesta:** isso não esconde o domínio. Certificados do Let's Encrypt
vão para os logs públicos de Certificate Transparency, então o nome é
descobrível de qualquer forma. O ganho é não servir o site a requisições com
`Host` alheio.

### Por que a aplicação precisa do `X-Forwarded-Proto`?

Porque o TLS termina no Nginx. Da porta 8080 em diante o tráfego é HTTP puro, no
loopback — a aplicação não tem como saber que o cliente veio por HTTPS.

`proxy_set_header X-Forwarded-Proto $scheme` transporta essa informação. Sem
ele, qualquer redirecionamento ou URL absoluta gerada pela aplicação sai
apontando para `http://`.

### Abrir a porta 443 exige o quê?

O mesmo de qualquer porta nova: **as duas camadas**.

1. Security List: regra de ingress `TCP` destino `443`
2. iptables: `-I INPUT <N>` antes do `REJECT`, seguido de
   `netfilter-persistent save`

Este passo foi esquecido na primeira tentativa — a porta 80 já estava aberta e o
redirecionamento funcionava, então o certificado parecia ser o único trabalho
novo. O sintoma foi `timeout` no `https://` com o `301` do `http://` funcionando
normalmente.

---

## NestJS e TypeScript

### `Parameter 'req' implicitly has an 'any' type` no middleware **[dúvida]**

O `app.use` do Nest aceita qualquer handler, então não infere os tipos. Importe
os do Express:

```typescript
import { NextFunction, Request, Response } from 'express';

app.use((req: Request, _res: Response, next: NextFunction) => {
  // ...
  next();
});
```

`@types/express` já vem nas `devDependencies` do `nest new`.

Dois detalhes:

- **`_res` com underscore** — o parâmetro não é usado, e o prefixo sinaliza isso
  ao linter. Não dá para omitir: o Express identifica middleware comum pela
  **quantidade** de parâmetros; com dois, trataria a função como outra coisa.
- **`?? '-'` nos headers** — `req.headers[...]` pode ser `string`, `string[]` ou
  `undefined`.

### O NestJS registra as requisições recebidas?

**Não por padrão.** Ele loga apenas as linhas de bootstrap — módulos e rotas
mapeadas. `docker logs` não mostra IP de cliente nenhum.

Para observar a origem das requisições é preciso um middleware explícito. Foi o
que a Tarefa 7 acrescentou, registrando método, caminho, `socket.remoteAddress`
e os dois headers de encaminhamento.

### Por que o `nest new` atrapalhou o `git add`?

Ele roda `git init` dentro de `api/`, criando um repositório aninhado. O git da
raiz recusa indexar:

```
error: 'api/' does not have a commit checked out
```

O repositório aninhado tinha zero commits. Resolvido removendo o `.git` de
dentro de `api/`, para que a pasta pertença ao repositório principal — que é o
que o plano prevê, já que a VM clona um repositório só.

---

## Diagnóstico

### `Connection refused` e `timeout` são a mesma coisa? **[revisão]**

Não, e a diferença diz **onde** está o problema:

| Sintoma | O que aconteceu | Onde olhar |
|---|---|---|
| `timeout` | silêncio — ninguém respondeu | o caminho: firewall descartando, rota faltando, resposta sem volta |
| `Connection refused` | veio um TCP RST: "cheguei, e não há nada escutando aqui" | o destino |

**`Connection refused` prova mais do que parece:** o pacote fez o caminho de ida
inteiro até a pilha de rede do destino, e a resposta fez o de volta. Os dois
sentidos funcionam; só faltava o serviço na porta.

Um `timeout` não prova nada disso — não significa ausência de rede, significa
que você não sabe qual das hipóteses ocorreu.

Firewall que quer esconder a máquina usa **DROP** (descarta calado, produz
timeout). Firewall que só quer negar usa **REJECT** (responde com erro).

Um `Connection refused` na porta 22 logo após criar a instância é normal: o
console marca `Running` antes de o `sshd` subir.

### Como descobrir de onde vem uma linha da configuração do Nginx?

```bash
sudo nginx -T
```

`-T` maiúsculo testa **e imprime** a configuração efetiva, com todos os
`include` resolvidos e o arquivo de origem de cada trecho. É a ferramenta certa
para "de onde vem isso" e para "o que está carregado agora".

`nginx -t` minúsculo só valida sintaxe — e a configuração **antiga** também é
sintaticamente válida, então ele não detecta "esqueci de salvar" nem "o reload
não pegou".

Verificação barata depois de um reload:

```bash
sudo nginx -T | grep -c proxy_set_header
```

### Como saber se um pacote chegou na VM?

```bash
sudo tcpdump -ni ens3 tcp port 80
```

Com isso rodando, dispare a requisição do cliente. Saída esperada quando o
pacote chega e nada responde:

```
177.16.235.121.64798 > 10.0.0.215.80: Flags [S], seq ..., length 0
177.16.235.121.64798 > 10.0.0.215.80: Flags [S], seq ..., length 0
177.16.235.121.64798 > 10.0.0.215.80: Flags [S], seq ..., length 0
```

O SYN repetido é retransmissão de TCP — o cliente insistindo porque nenhuma
resposta voltou.

Ruído esperado na captura: conversas com `169.254.169.254`, o serviço de
metadados da instância.

### Por que `grep ':80'` não serve para filtrar porta?

Porque casa também com `:8080` — é substring, não porta. Para filtrar porta de
verdade:

```bash
sudo ss -tlnp sport = :80
```

### Como ler a saída do `ss`?

```
LISTEN 0 4096   127.0.0.1:8080   0.0.0.0:*   users:(("docker-proxy",pid=3686))
                └─ local ─┘      └─ peer ─┘
```

A primeira coluna é o **bind local** — é ela que importa para saber se o
serviço está exposto. A segunda é o *peer*, e `0.0.0.0:*` ali significa "aceita
de qualquer origem", não um bind aberto.

Quem segura o socket no host é o `docker-proxy`, não o processo Node — esse
vive no namespace de rede do container.

### Por que o IP público não aparece em `ip addr show`?

Porque ele não existe dentro do Ubuntu. É NAT feito pela OCI sobre o IP privado
da VNIC. A interface mostra `10.0.0.215` e nada mais.
