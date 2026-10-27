# TaskMeet
Quadros estilo Trello + gravações do Plaud ligadas por nome + avisos de prazo por e-mail (Outlook).

Rodar: `python server.py` e abrir http://localhost:8000 (só Python 3).

## Plaud
O app não grava áudio: a gravação é feita no Plaud. Dê à gravação um nome que **contenha o título do cartão**
(ou, se não houver cartão, do projeto). Maiúsculas e acentos não importam; vence o título mais longo.
Ex.: cartão "Página de contato" <- gravação "Reunião página de contato 21/10".
Sem correspondência, a gravação vai para 📥 Plaud, onde você escolhe o destino.

Qualquer fonte entrega a gravação com:
`POST /api/plaud  {"plaud_id": "...", "name": "...", "transcript": "...", "summary": "...", "created": "ISO"}`
Repetir o mesmo plaud_id atualiza o texto sem duplicar nem mudar o vínculo.

## Configuração (opcional): copie config.example.json para config.json
- SMTP_USER/SMTP_PASS: Outlook/Office 365 (SMTP AUTH habilitado; senha de app se houver MFA). Sem isso, avisos só no histórico.
- ANTHROPIC_API_KEY: botão extra "Resumir e organizar".
- NOTIFY_HOURS: antecedência do aviso (padrão 24h).
