# 00 — Provisionamento da VM na Oracle Cloud

> Corresponde à **Tarefa 2** do plano de implementação.
> Pré-requisito: conta na Oracle Cloud com Always Free disponível.

---

## 1. Conceito

### Por que uma máquina virtual precisa de uma rede antes de existir

Numa nuvem pública, sua VM não é ligada diretamente à internet. Ela nasce
dentro de uma rede virtual privada, que você define, e só alcança o mundo
externo se você construir esse caminho explicitamente. É o inverso da
intuição de quem só usou máquina local: aqui o padrão é o isolamento, e a
conectividade é o que precisa ser configurado.

Quatro peças formam esse caminho.

### VCN — Virtual Cloud Network

A rede virtual privada da sua conta, com um bloco de endereços IP próprio
(algo como `10.0.0.0/16`). Tudo que você criar na OCI vive dentro de uma VCN.
Ela é o equivalente virtual da rede da sua casa: existe, tem endereços
internos, e por si só não fala com a internet.

### Subnet pública e subnet privada

Uma VCN é subdividida em subnets — faixas menores dentro do bloco de
endereços. A diferença entre as duas é a rota padrão:

- **Subnet pública:** as instâncias podem receber um IP público, e a tabela de
  rotas manda o tráfego de saída para um Internet Gateway.
- **Subnet privada:** as instâncias não recebem IP público. Alcançam a internet
  apenas para *saída*, via NAT Gateway, e nunca podem ser alcançadas de fora.

Uma API que precisa ser acessada pela internet fica na subnet pública. Um banco
de dados fica na privada. Nesta POC, a instância vai na **pública** — se
estivesse na privada, nenhuma configuração de Nginx no mundo tornaria a API
acessível de fora, porque o tráfego de entrada não teria rota até ela.

### Internet Gateway

O componente que dá à VCN um caminho de ida e volta com a internet. Sem ele,
uma subnet "pública" não é pública de fato. O assistente da OCI cria e associa
o Internet Gateway automaticamente, o que é conveniente e também esconde essa
peça de quem está aprendendo — vale saber que ela existe.

### Security List — a primeira camada de firewall

Um firewall **de rede**, avaliado pela infraestrutura da OCI antes do pacote
chegar à sua VM. Ele não roda dentro da máquina; não adianta procurá-lo com
`ps` ou `systemctl`. É uma lista de regras que dizem qual tráfego pode entrar
(*ingress*) e sair (*egress*) da subnet.

Por padrão, uma subnet criada pelo assistente libera apenas a porta 22 (SSH) na
entrada. Toda outra porta — inclusive a 80 — está bloqueada nesse nível.

As regras são **stateful**: se a entrada de uma conexão é permitida, a resposta
correspondente sai automaticamente. Você não precisa escrever uma regra de saída
para cada regra de entrada.

> **Ponto que define a estratégia desta POC:** a Security List é a primeira de
> **duas** camadas de firewall. A segunda roda dentro da própria VM e é
> assunto da apostila 02a. Abrir só uma das duas não funciona, e o sintoma é
> idêntico nos dois casos: timeout. Por isso a Tarefa 6 do plano abre as duas
> em sequência, testando entre uma e outra.

### Par de chaves SSH

Em vez de senha, o acesso usa criptografia assimétrica: um par de arquivos
matematicamente ligados.

- **Chave pública** (`.pub`): você entrega para a OCI durante a criação da
  instância. Ela é copiada para dentro da VM, em
  `~/.ssh/authorized_keys`. Pode ser divulgada sem risco.
- **Chave privada** (sem extensão): fica só na sua máquina. Quem tem esse
  arquivo entra na VM. Não tem recuperação — perdeu a chave, perdeu o acesso.

Por isso o `.gitignore` deste repositório exclui `*.pem`, `*.key` e
`id_rsa*`: chave privada em repositório público é uma das formas mais rápidas
de ter uma VM sequestrada para mineração.

### Swap: por que 1 GB de RAM exige preparação

Swap é espaço em disco que o sistema usa como extensão da memória RAM. É muito
mais lento que RAM, mas evita o cenário em que o kernel simplesmente mata um
processo por falta de memória — o *OOM killer*.

`npm install` seguido de `nest build` consome mais que 1 GB em picos. Sem swap,
o build morre. A mensagem que aparece costuma ser um `Killed` seco, ou um erro
genérico do npm, e nada nela aponta para memória. É um erro caro de diagnosticar
depois e trivial de evitar antes.

---

## 2. Referências oficiais

- **Security Lists** —
  https://docs.oracle.com/en-us/iaas/Content/Network/Concepts/securitylists.htm
- **VCNs and Subnets** —
  https://docs.oracle.com/en-us/iaas/Content/Network/Tasks/managingVCNs.htm
- **Best Practices for Your Compute Instances** —
  https://docs.oracle.com/en-us/iaas/Content/Compute/References/bestpracticescompute.htm
- **Install Docker Engine on Ubuntu** —
  https://docs.docker.com/engine/install/ubuntu/

---

## 3. Exercício

Siga a Tarefa 2 do plano. Em resumo:

1. Gerar o par de chaves SSH no Windows.
2. Criar a VCN pelo assistente com conectividade à internet.
3. Criar a instância `VM.Standard.E2.1.Micro` com Ubuntu Server, na subnet
   **pública**, com IP público atribuído e a chave pública colada.
4. Conectar por SSH — este passo precisa funcionar antes de qualquer outro.
5. Criar 2 GB de swap em arquivo e torná-lo permanente via `/etc/fstab`.
6. Instalar `git`, `curl` e Docker; adicionar o usuário `ubuntu` ao grupo
   `docker`; reconectar.

O usuário padrão das imagens Ubuntu na OCI é `ubuntu`. Não é `root`, nem
`opc` (esse é o das imagens Oracle Linux).

---

## 4. Como validar

Na VM:

```bash
free -h
```

Esperado: linha `Swap` com aproximadamente `2.0Gi`.

```bash
docker run hello-world
```

Esperado: a mensagem "Hello from Docker!", **sem** `sudo`.

Do Windows:

```bash
ssh -i $env:USERPROFILE\.ssh\oci-poc-nginx ubuntu@<ip-publico>
```

Esperado: shell da VM.

---

## 5. Armadilhas

**A Security List não abre porta nenhuma sozinha.**
Existe uma segunda camada de firewall dentro da VM. Isso só aparece na
apostila 02a, mas fique com a informação desde já: quando o acesso externo
falhar depois de você ter aberto a Security List, o comportamento é o
esperado, não um erro seu.

**Criar a instância na subnet privada.**
O assistente cria as duas subnets, e a seleção fica num dropdown fácil de
passar batido. Numa subnet privada não há como atribuir IP público, e o campo
correspondente some do formulário — se você não está vendo a opção de IP
público, é esse o motivo.

**`docker` pedindo permissão depois do `usermod`.**
A adição ao grupo só vale em sessão nova. Sair do SSH e entrar de novo resolve.
Usar `sudo docker` como contorno funciona, mas gera arquivos com dono errado e
esconde o problema.

**Build sem swap.**
Se você pular o swap e for direto para a Tarefa 4, o `docker build` morre e a
mensagem vai apontar para o npm. Faça o swap antes, mesmo que pareça
desnecessário agora.

**Chave privada no repositório.**
O `.gitignore` deste projeto já cobre os nomes previstos. Se você salvar a chave
com outro nome, confira `git status` antes de commitar.

**`Out of capacity` na criação.**
O Always Free tem capacidade limitada por região. Se aparecer, tente outro
domínio de disponibilidade (Availability Domain) no mesmo formulário, ou repita
mais tarde. Não é erro de configuração.

---

**Próximo:** [`01-api-nestjs-docker.md`](01-api-nestjs-docker.md)
