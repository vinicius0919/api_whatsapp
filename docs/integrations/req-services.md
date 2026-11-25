# Integração HTTP com req-services

O Gateway permanece genérico: não interpreta pedidos, aprovações ou recusas. Ele gerencia sessões, mensagens e webhooks.

## Fluxo e autenticação

```text
req-services ──API Key──> Gateway ──Baileys──> WhatsApp
       ^                       |
       └──── webhook HMAC ─────┘
```

As rotas versionadas usam `x-api-key`, `x-application-id` e `x-whatsapp-session` quando aplicável. Para cadastrar uma assinatura:

```bash
curl -X POST http://127.0.0.1:3003/api/v1/webhooks \
  -H 'x-api-key: <API_KEY>' -H 'x-application-id: default' \
  -H 'x-whatsapp-session: default' -H 'content-type: application/json' \
  -d '{"url":"https://consumer.example.test/webhooks/whatsapp","events":["message.received"],"secret":"<SECRET_COM_16_OU_MAIS_CARACTERES>"}'
```

O segredo é cifrado e não é retornado novamente em claro. A aplicação só pode administrar suas próprias assinaturas.

## Evento `message.received`

Headers: `X-Webhook-Timestamp`, `X-Webhook-Event-Id` e `X-Webhook-Signature: sha256=<hexadecimal>`.

```json
{
  "eventId": "msg_default_reply-1",
  "type": "message.received",
  "sessionId": "default",
  "timestamp": "2026-11-24T15:00:00.000Z",
  "data": {
    "sessionId": "default",
    "messageId": "reply-1",
    "chatId": "120363432779760997@g.us",
    "senderJid": "5511999999999@s.whatsapp.net",
    "senderLid": "12345@lid",
    "phoneNumber": "5511999999999",
    "displayName": "Contato de teste",
    "isGroup": true,
    "fromMe": false,
    "forwarded": false,
    "type": "extendedTextMessage",
    "text": "Aprovar",
    "quotedMessage": {
      "messageId": "pedido-original-1",
      "chatId": "120363432779760997@g.us",
      "participantJid": "5511888888888@s.whatsapp.net",
      "participantLid": "98765@lid",
      "text": "Pedido para análise"
    }
  }
}
```

`messageId` identifica a mensagem recebida; `quotedMessage.messageId` identifica a mensagem citada. LID não deve ser convertido em telefone sem resolução confiável. Mensagens próprias e conversas fora do monitoramento não geram `message.received`.

Calcule a assinatura com HMAC-SHA256 de `<timestamp>.<eventId>.<rawBody>` usando o segredo cadastrado. Compare em tempo constante e use o corpo original, antes de reserializar o JSON.

## Envio e resposta citada

```bash
curl -X POST http://127.0.0.1:3003/api/v1/messages/text \
  -H 'x-api-key: <API_KEY>' -H 'x-application-id: default' \
  -H 'x-whatsapp-session: default' -H 'content-type: application/json' \
  -d '{"sessionId":"default","to":"120363432779760997@g.us","text":"Resposta","quotedMessageId":"pedido-original-1"}'
```

O ID retornado é o identificador real fornecido pelo Baileys. A referência citada deve pertencer à mesma sessão e ao mesmo chat.

## Entrega, erros e homologação

A entrega é pelo menos uma vez. O consumidor deve deduplicar por `eventId`, tratar timeouts, respostas não-2xx e eventos fora de ordem. O Gateway persiste tentativas em MongoDB, mas não oferece exatamente uma vez nem transação distribuída entre persistência e entrega.

Para homologação sem mensagem real, use o receptor local:

```bash
WEBHOOK_TEST_SECRET='segredo-ficticio-com-mais-de-16' npm run webhook:test-server
TEST_MONGODB_URI='mongodb://127.0.0.1:27017/api_whatsapp_test' \
WEBHOOK_TEST_SECRET='segredo-ficticio-com-mais-de-16' npm run webhook:test
```

O fluxo cria e remove apenas seus documentos temporários, publica evento sintético e valida HMAC, entrega, deduplicação e assinatura inválida. `WEBHOOK_ALLOW_LOCAL_TEST=true` permite apenas o endereço definido por `WEBHOOK_LOCAL_TEST_HOST`, `WEBHOOK_LOCAL_TEST_PORT` e `WEBHOOK_LOCAL_TEST_PATH` fora de produção; o padrão bloqueia destinos HTTP locais.

Após reiniciar o Gateway com essa configuração, atualize a subscription local existente sem criar outra:

```bash
npm run webhook:update-local
```

O comando usa a API autenticada, exige exatamente uma subscription ativa de `message.received` para `default` e preserva o identificador e os eventos pendentes.

## Railway

Use URL HTTPS pública, mantenha `WEBHOOK_ALLOW_LOCAL_TEST=false`, configure `WEBHOOK_ENCRYPTION_KEY` fora do repositório e mantenha o MongoDB Atlas isolado do desenvolvimento. O consumidor deve ser idempotente por `eventId`. Não execute duas instâncias compartilhando a mesma sessão Baileys.
