# Central CVB-MG
Tarefas por setor (A fazer, Em andamento, Concluído, Bloqueado), reuniões gravadas no Plaud ligadas às tarefas,
notificações dentro do sistema e avisos de prazo por e-mail (Outlook). Visual do pacote de design (tema escuro).

Rodar: `python server.py` e abrir http://localhost:8000 (só Python 3, sem instalar nada).

## Telas
Início (resumo, quadro, calendário, tarefas de hoje, notificações), Quadros (filtros por setor, responsável e prioridade),
Minhas tarefas, Notificações, Calendário, Reuniões, uma página por Setor e o modal da tarefa. **Arquivos** ainda é só uma página "em breve".
Busca no cabeçalho (atalho Ctrl+K): tarefas, setores e, para a gestão, pessoas.

## Setores
TI, Administrativo e RH, Financeiro, Compras, Frotas e Projetos (criados automaticamente). Cada tarefa pertence a um setor, tem
status, prioridade, prazo, responsável (uma pessoa cadastrada), cor opcional, comentários e reuniões.
Funcionários e leitores só enxergam os setores em que foram adicionados (página do setor > Membros).

## Perfis
| Perfil | Quem | Pode |
|---|---|---|
| Administrador | TI (só existe um) | cadastra e gerencia usuários, envia os convites, configurações; vê todos os setores |
| Gestor | CEO | vê e gerencia **todos** os setores: cria/edita/move/exclui tarefas, membros, reuniões e caixa do Plaud |
| Membro | funcionário | nos setores em que foi adicionado: ver o que falta e o que foi feito, comentar, marcar tarefa como concluída, consultar reuniões |
| Leitor | | só visualiza os setores em que foi adicionado |

### Como as pessoas entram
1. Primeiro acesso ao sistema: a tela pede a conta da **TI** (administrador), com e-mail @cvbmg.org.br. Não existe outro administrador.
2. A TI cadastra as pessoas (menu do usuário > Usuários e convites), um e-mail institucional por linha, com o perfil. Elas ficam **sem senha**.
3. No lançamento, a TI clica em **Enviar convites a todos**. Cada pessoa recebe por e-mail um link, abre e **cria a própria senha**.
4. Perdeu a senha ou o link venceu (14 dias)? Na tela de entrada: "Primeiro acesso ou esqueci a senha". A TI também pode reenviar ou copiar o link.
5. Depois a gestão adiciona cada pessoa aos setores dela.

Só entram e-mails do domínio `ALLOWED_DOMAIN` (padrão `cvbmg.org.br`). A TI nunca vê nem define a senha de ninguém.

**Importante:** defina `BASE_URL` no config.json com o endereço pelo qual os funcionários acessam (ex.: `http://192.168.0.10:8000`). É esse endereço que vai dentro do link do convite.
Sem SMTP configurado os convites não saem: o sistema mostra os links para a TI copiar e mandar por outro meio.

Senhas ficam com hash (PBKDF2), sessão de 14 dias, bloqueio de 5 min após 5 senhas erradas.
Perdeu o acesso da TI: `python server.py setpw EMAIL NOVA_SENHA`.

**Acesso pela rede:** por padrão só este computador acessa (HOST=127.0.0.1). Para os colegas, defina `"HOST": "0.0.0.0"` no config.json.
Não há HTTPS: use só em rede interna confiável, ou atrás de um proxy com HTTPS.

## Notificações
- No sino: comentário em tarefa sua, tarefa atribuída a você, reunião registrada na tarefa, prazo próximo ou vencido.
- Por e-mail: prazo próximo/vencido (`NOTIFY_HOURS`, padrão 24 h), uma vez por prazo, para o responsável da tarefa.

## Plaud
O app não grava áudio: a gravação é feita no Plaud. Dê à gravação um nome que contenha o **título da tarefa** (ou, se não houver, o **nome do setor**).
Maiúsculas e acentos não importam; vence o título mais longo. Sem correspondência, a gravação aparece em Reuniões > "Sem destino" para a gestão escolher.

Qualquer fonte entrega a gravação com o cabeçalho `X-Import-Token` (token em Configurações, só a TI):
`POST /api/plaud  {"plaud_id": "...", "name": "...", "transcript": "...", "summary": "...", "created": "ISO"}`
Repetir o mesmo plaud_id atualiza o texto sem duplicar nem mudar o vínculo.

## Configuração (opcional): copie config.example.json para config.json
- SMTP_USER/SMTP_PASS: Outlook/Office 365 (SMTP AUTH habilitado; senha de app se houver MFA).
- ANTHROPIC_API_KEY: botão extra "Resumir e organizar" nas reuniões.
- NOTIFY_HOURS, BASE_URL, ALLOWED_DOMAIN, HOST, PORT.

## Dados antigos
As tabelas da versão com projetos/listas/cartões continuam no banco, sem uso (nada foi apagado). Há uma cópia em `taskmeet.backup-antes-dos-setores.db`.
