# API WhatsApp

Gateway privado para envio de mensagens usando Node.js, Express e Baileys. A API foi estruturada para permitir múltiplas aplicações próprias e evolução futura para múltiplas sessões do WhatsApp.

## Requisitos

- Node.js 20 ou superior.
- MongoDB 6 ou superior para persistência de sessões, mensagens, eventos e webhooks.
- Uma conta WhatsApp para pareamento via QR Code.

O projeto usa CommonJS na aplicação e carrega o Baileys ESM via `import()` dinâmico. Use a versão indicada em `.nvmrc` (`nvm use`) antes de executar a API.

## Instalação

```bash
npm install
cp .env.example .env
cp config/api-keys.json.example config/api-keys.json
```

Gere um hash para uma chave, sem armazenar a chave original:

```bash
npm run hash-api-key -- "uma-chave-local-segura"
```

Copie o resultado para `keyHash` em `config/api-keys.json`. Esse arquivo é ignorado pelo Git e não deve ser commitado.

Cada chave possui autorização explícita:

```json
{
  "id": "minha-aplicacao",
  "role": "application",
  "enabled": true,
  "keyHash": "scrypt$...",
  "applications": ["minha-aplicacao"],
  "sessions": ["default"]
}
```

As requisições autenticadas usam `x-api-key` ou `Authorization: Bearer ...`. Para selecionar escopos, envie também `x-application-id` e `x-whatsapp-session`.

## Execução

```bash
npm start
# desenvolvimento
npm run dev
```

O primeiro início exibe o QR Code no terminal. A sessão é persistida no diretório configurado por `WHATSAPP_AUTH_DIR`. Sessões existentes não são removidas automaticamente.

O gateway conecta ao MongoDB antes de assumir os sockets. A sessão legada `default` continua usando `auth/`; novas sessões usam diretórios derivados de IDs validados em `WHATSAPP_SESSION_AUTH_ROOT`. O diretório `.session-locks` impede duas instâncias de abrirem a mesma sessão.

Quando a sessão legada `default` ainda possui `ownerApplicationId: "system"`, ela é mapeada somente em memória para `WHATSAPP_DEFAULT_APPLICATION_ID` (padrão `default`) para preservar integrações existentes. Essa exceção se aplica exclusivamente à sessão `default` e ao proprietário legado `system`; sessões nomeadas e sessões com qualquer outro proprietário permanecem isoladas e não têm sua propriedade alterada.

## Endpoints

| Método | Endpoint | Autorização | Descrição |
| --- | --- | --- | --- |
| `GET` | `/health` | Pública | Estado real da API e da sessão padrão |
| `POST` | `/messages/send` | API key | Envia texto para número ou JID |
| `GET` | `/groups` | API key | Lista grupos da sessão autorizada |
| `POST` | `/groups/send` | API key | Envia texto para contato ou grupo |
| `GET` | `/qr` | API key de admin | Exibe QR Code da sessão autorizada |

### API versionada

| Método | Endpoint | Descrição |
| --- | --- | --- |
| `POST` | `/api/v1/sessions` | Cria uma sessão nova; a sessão `default` é reservada à compatibilidade legada |
| `GET` | `/api/v1/sessions` | Lista sessões autorizadas |
| `GET` | `/api/v1/sessions/:id` | Consulta o estado de uma sessão |
| `POST` | `/api/v1/sessions/:id/connect` | Inicia ou reconecta uma sessão |
| `GET` | `/api/v1/sessions/:id/qr` | Obtém o QR Code da sessão autorizada |
| `POST` | `/api/v1/sessions/:id/disconnect` | Desconecta temporariamente, sem apagar credenciais |
| `POST` | `/api/v1/messages/text` | Envia texto por uma sessão autorizada |
| `GET` | `/api/v1/messages/:id` | Consulta uma mensagem persistida |
| `GET` | `/api/v1/sessions/:id/messages` | Lista mensagens da sessão |
| `POST` | `/api/v1/webhooks` | Registra webhook da aplicação autenticada |
| `GET` | `/api/v1/webhooks` | Lista webhooks da aplicação autenticada |
| `DELETE` | `/api/v1/webhooks/:id` | Remove webhook da aplicação autenticada |

O envio versionado aceita `sessionId`, `to`, `message` ou `text`. A aplicação é derivada da API key, nunca do corpo. `Idempotency-Key` pode ser usado quando MongoDB estiver conectado.

## Eventos e webhooks

Os eventos internos incluem `session.connected`, `session.disconnected`, `session.qr_required`, `session.logged_out`, `message.received`, `message.sent`, `message.updated` e `message.failed`. Eles são persistidos antes de serem encaminhados ao dispatcher.

Webhooks usam HTTPS, bloqueiam destinos privados/loopback/link-local, desabilitam redirecionamentos e aplicam timeout. O segredo é cifrado com `WEBHOOK_ENCRYPTION_KEY`, nunca armazenado em claro. A assinatura enviada usa:

```text
X-Webhook-Timestamp: <ISO-8601>
X-Webhook-Event-Id: <eventId>
X-Webhook-Signature: sha256=<HMAC_SHA256(timestamp.eventId.rawBody)>
```

A entrega é pelo menos uma vez, com retry persistente, limite de tentativas e possível fora de ordem.

Exemplo:

```bash
curl -X POST http://localhost:3000/messages/send \
  -H 'Content-Type: application/json' \
  -H 'x-api-key: SUA_CHAVE' \
  -H 'x-application-id: minha-aplicacao' \
  -H 'x-whatsapp-session: default' \
  -d '{"number":"5511999999999","message":"Olá"}'
```

## Testes

```bash
npm test
```

Os testes cobrem autenticação, contratos legados e versionados, autorização por aplicação/sessão, rate limiting, normalização de mensagens, QR, credenciais, reconexão, backoff, logout, múltiplas sessões e segurança de webhooks. Não usam MongoDB real nem sessões WhatsApp reais.

## Segurança e operação

- Nunca versione `.env`, `config/api-keys.json` ou qualquer diretório `auth/`.
- Restrinja `CORS_ORIGIN` aos frontends autorizados.
- Use HTTPS e um proxy reverso em ambientes compartilhados.
- O endpoint `/health` é liveness e retorna HTTP `200` enquanto o processo está ativo; `/ready` retorna `503` até MongoDB e sessão WhatsApp estarem prontos.
- `npm run migrate-api-keys` é uma migração explícita e não destrutiva dos hashes do JSON para `Application`; ela não remove o JSON nem invalida credenciais.
- Em produção, prefira provisionar aplicações e hashes no MongoDB com `npm run provision-application -- --apply`; o arquivo `config/api-keys.json` é somente fallback local e não deve ser versionado.
- Não há migração automática de `auth/`, logout, limpeza de credenciais, download de mídia ou fila externa.

## Integração de mensagens recebidas e respostas citadas

As mensagens recebidas são normalizadas antes de serem persistidas e publicadas no evento `message.received`. O payload inclui `sessionId`, `messageId`, `chatId`, `senderJid` quando disponível, `senderLid` quando o WhatsApp fornece um LID, `phoneNumber` somente quando o JID é telefônico, `displayName`, `isGroup`, `fromMe`, `type`, `text`, `timestamp`, `forwarded` e `quotedMessage`.

Exemplo de evento enviado ao webhook:

```json
{
  "eventId": "msg_default_reply-1",
  "type": "message.received",
  "sessionId": "default",
  "timestamp": "2026-11-24T15:00:00.000Z",
  "data": {
    "sessionId": "default",
    "messageId": "reply-1",
    "chatId": "120363@g.us",
    "senderJid": "5511999999999@s.whatsapp.net",
    "senderLid": "12345@lid",
    "phoneNumber": "5511999999999",
    "displayName": "Contato de teste",
    "isGroup": true,
    "fromMe": false,
    "type": "extendedTextMessage",
    "text": "Minha resposta",
    "timestamp": "2026-11-24T15:00:00.000Z",
    "forwarded": false,
    "quotedMessage": {
      "messageId": "original-1",
      "chatId": "120363@g.us",
      "participantJid": "5511888888888@s.whatsapp.net",
      "type": "conversation",
      "text": "Mensagem original"
    }
  }
}
```

`messageId` identifica a mensagem recebida. `quotedMessage.messageId` identifica a mensagem citada. Um LID nunca é convertido em número telefônico. O conteúdo bruto do Baileys não é enviado ao webhook; uma representação textual mínima é mantida internamente para permitir citações sem persistir chaves de mídia.

O campo persistido `whatsappMessageId` é o identificador usado pelo índice de unicidade da mensagem; ele não deve ser confundido com o `messageId` do payload normalizado, que possui o mesmo valor no evento recebido. `quotedMessage` é um subdocumento estruturado, preservando `messageId`, `chatId`, `participantJid`, `participantLid`, `type` e `text` quando disponíveis.

O índice composto de `idempotencyKey` é parcial e considera somente valores string. Assim, mensagens inbound sem chave não entram na unicidade de idempotência. O índice de `(sessionId, whatsappMessageId)` continua protegendo a deduplicação real de mensagens WhatsApp.

### Migração dos índices de mensagens

O Gateway não executa migrações de índices durante a inicialização. Inspecione primeiro o banco explicitamente configurado:

```bash
npm run migrate-message-indexes -- --dry-run
```

Após revisar o relatório e autorizar a operação, execute:

```bash
npm run migrate-message-indexes -- --apply
```

O modo `--apply` aborta quando existem conflitos de `idempotencyKey`, cria/verifica o índice parcial antes de remover o índice sparse legado e não altera documentos. A remoção opcional do índice de texto legado `quotedMessage_text` exige autorização adicional:

```bash
npm run migrate-message-indexes -- --apply --drop-quoted-text-index
```

Se a migração for interrompida após a criação do índice parcial, execute novamente o mesmo comando: a operação é idempotente. Se a remoção do índice legado falhar, preserve o Gateway parado e revise os índices antes de novas tentativas. O script nunca usa `dropIndexes()` nem `syncIndexes()`.

O `autoIndex` da conexão da aplicação está desabilitado. Em uma instalação nova, execute o dry-run e depois o `--apply` autorizado antes de liberar tráfego, para que os índices necessários existam sem depender do boot do processo.

### Provisionamento de bancos novos

Para provisionar todos os índices declarados pelos modelos, sem remover índices existentes:

```bash
npm run initialize-indexes -- --dry-run
npm run initialize-indexes -- --apply
```

O comando `--apply` é explícito, idempotente e interrompe a execução quando encontra uma definição incompatível. Em bancos existentes com o índice sparse legado de mensagens, execute primeiro `migrate-message-indexes -- --dry-run` e a migração específica autorizada; depois valide novamente com `initialize-indexes -- --dry-run`. A suíte de integração usa exclusivamente `TEST_MONGODB_URI` e cria os índices explicitamente antes dos testes.

### Envio versionado

```bash
curl -X POST http://localhost:3000/api/v1/messages/text \
  -H 'Content-Type: application/json' \
  -H 'x-api-key: SUA_CHAVE' \
  -H 'x-application-id: minha-aplicacao' \
  -H 'x-whatsapp-session: default' \
  -H 'Idempotency-Key: pedido-123-notificacao-1' \
  -d '{"to":"5511999999999","text":"Resposta","quotedMessageId":"original-1"}'
```

Resposta de criação:

```json
{
  "sessionId": "default",
  "messageId": "ABCD1234",
  "id": "ABCD1234",
  "chatId": "5511999999999@s.whatsapp.net",
  "status": "sent",
  "timestamp": "2026-11-24T15:00:00.000Z",
  "replayed": false
}
```

`messageId` é o identificador retornado pelo Baileys. O Gateway não cria um ID local substituto. `sent` significa aceito pelo socket; entrega e leitura dependem dos eventos de atualização recebidos posteriormente. `quotedMessageId` deve pertencer à mesma sessão e ao mesmo chat; referências inexistentes retornam `404`, referências de outro chat retornam `409` e mensagens sem conteúdo textual recuperável retornam `422`.

No recebimento, a mensagem é validada e persistida antes de `message.received` ser publicado. A persistência e a publicação não formam uma transação distribuída: uma falha após a gravação e antes do evento pode exigir reconciliação operacional. Quando o evento existe, a deduplicação por `eventId` e o retry do webhook continuam ativos; o Gateway não cria filas ou workers adicionais.

Os endpoints legados `/messages/send` e `/groups/send` continuam disponíveis e aceitam opcionalmente `quotedMessageId`. Eles mantêm HTTP 200 por compatibilidade, mas agora retornam também `messageId`, `chatId`, `status`, `timestamp` e `replayed`.

### Estados operacionais

- `GET /health` informa que o processo está ativo; `GET /ready` retorna `503` enquanto MongoDB ou a sessão padrão não estiverem prontos.
- `GET /ready` retorna `200` somente quando MongoDB e a sessão padrão estão prontos; caso contrário retorna `503`.
- O webhook possui entrega pelo menos uma vez. Consumidores devem deduplicar por `eventId`; eventos podem chegar duplicados ou fora de ordem.

### Monitoramento seletivo

O recebimento de mensagens pode ser controlado sem afetar o envio ou a listagem de grupos:

```env
WHATSAPP_MONITOR_MODE=allowlist
WHATSAPP_MONITORED_GROUPS=120363432779760997@g.us
WHATSAPP_DEBUG_INBOUND=false
```

Os modos são:

- `all`: processa conversas privadas e grupos.
- `allowlist`: processa somente os grupos listados por JID, separados por vírgula.
- `none`: desativa o processamento de mensagens recebidas.

Quando essas variáveis não são configuradas, o comportamento padrão é `all`. Mensagens próprias e eventos históricos de sincronização nunca geram `message.received`; o Gateway continua podendo persistir e publicar mensagens enviadas pelo serviço HTTP. O nome do grupo não é usado para autorização.

### Limitações

O suporte de citação depende do conteúdo que foi persistido. Mensagens de mídia sem legenda não possuem representação textual suficiente para serem reconstruídas como citação após reinício. Menções, reações, botões/listas interativos, download de mídia e edição de mensagens não fazem parte desta fase e exigem validação específica da versão instalada do Baileys antes de serem expostos.

O Baileys é uma integração não oficial com o WhatsApp. A sessão pode ser desconectada ou exigir novo pareamento. Em Railway, use volume persistente para `WHATSAPP_AUTH_DIR` e `WHATSAPP_SESSION_AUTH_ROOT`; não execute duas instâncias usando a mesma sessão.

### Homologação de webhooks

O receptor e o fluxo isolado estão documentados em [docs/integrations/req-services.md](docs/integrations/req-services.md). O receptor local só é permitido explicitamente fora de produção:

```bash
WEBHOOK_ALLOW_LOCAL_TEST=true npm run webhook:test-server
TEST_MONGODB_URI=mongodb://127.0.0.1:27017/api_whatsapp_test npm run webhook:test
```

O fluxo publica um evento sintético e não envia mensagens ao WhatsApp. O padrão continua bloqueando destinos HTTP locais.
