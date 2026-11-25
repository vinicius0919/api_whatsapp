# Implantação no Railway

Este documento descreve uma implantação gradual do Gateway WhatsApp. O deploy não é executado por este projeto.

## Serviços

- `api-whatsapp`: este Gateway Node.js/Express/Baileys.
- `backend-req-services`: API HTTP que mantém os pedidos e recebe os webhooks.
- MongoDB Atlas separado para o Gateway, sem compartilhar o banco de pedidos.
- MongoDB Atlas do req-services, mantido separado e configurado no backend.
- Frontend estático e Telegram permanecem serviços independentes.

Não são necessários RabbitMQ, Redis, workers ou filas.

Os quatro repositórios permanecem independentes. O Railway pode usar os buildpacks Node.js com `npm ci` e os comandos existentes; Dockerfile não é necessário para esta topologia. Se a equipe optar por Docker posteriormente, o `.dockerignore` do Gateway exclui credenciais, sessões e artefatos locais.

## Gateway WhatsApp

O painel administrativo fica no mesmo serviço, em `/admin`. Ele autentica a API key exclusivamente em memória e consulta `/admin/api/auth`, `/health`, `/ready`, `/api/v1/sessions` e `/api/v1/sessions/:id/qr` com cabeçalhos. A chave não é armazenada no navegador. O painel não cria sessões, não faz logout remoto e não envia mensagens.

Configure `PORT` usando a variável fornecida pelo Railway e faça o processo escutar em `0.0.0.0`. O processo abre o listener HTTP antes de tentar MongoDB ou WhatsApp: `GET /health` retorna `200` enquanto o processo está vivo, mesmo durante falha de Atlas, QR Code ou reconexão; `GET /ready` retorna `503` até MongoDB e sessão estarem operacionais. Configure o healthcheck do Railway para `/health`, nunca `/ready`, porque a ausência temporária de autenticação WhatsApp não deve impedir o deploy do processo HTTP.

Variáveis principais:

- `MONGODB_URI`: banco Atlas exclusivo do Gateway.
- `PORT`: fornecida pelo Railway.
- `NODE_ENV=production`: ativa validações de produção e impede exceções locais de SSRF.
- `WEBHOOK_ENCRYPTION_KEY`: obrigatória em produção e usada para cifrar os segredos das subscriptions.
- `WHATSAPP_AUTH_DIR`: diretório persistente das credenciais da sessão legada.
- `WHATSAPP_SESSION_AUTH_ROOT`: diretório persistente das demais sessões.
- `WHATSAPP_DEFAULT_APPLICATION_ID`: aplicação padrão da sessão legada, normalmente `default`.
- `WHATSAPP_MONITOR_MODE` e `WHATSAPP_MONITORED_GROUPS`: monitoramento seletivo, quando necessário.

Use um volume persistente montado em `/data` e configure `WHATSAPP_AUTH_DIR=/data/auth`, `WHATSAPP_SESSION_AUTH_ROOT=/data/auth-sessions` e `WHATSAPP_SESSION_LOCK_ROOT=/data/.session-locks`. O diretório `API_KEY_STORE` não deve ser a fonte de autenticação de produção: mantenha a aplicação e os hashes na coleção `applications` do MongoDB do Gateway. Não execute duas instâncias utilizando a mesma sessão Baileys. A exceção `WEBHOOK_ALLOW_LOCAL_TEST` deve permanecer desativada ou ausente em produção; o Gateway deve aceitar somente destinos HTTPS válidos.

### Provisionamento da aplicação

`config/api-keys.json` é ignorado pelo Git e serve apenas como fallback local. Em produção, armazene a aplicação e o hash da API key na coleção `applications` do banco do Gateway. O script abaixo recebe a chave somente pela variável de ambiente, nunca por argumento ou log:

```bash
APPLICATION_ID=req-services \
APPLICATION_NAME=req-services \
APPLICATION_API_KEY='<chave-fornecida-pelo-secret-manager>' \
APPLICATION_ROLE=application \
APPLICATION_SESSIONS=default \
APPLICATION_PERMISSIONS=messages:send,webhooks:manage \
npm run provision-application -- --dry-run

APPLICATION_ID=req-services \
APPLICATION_NAME=req-services \
APPLICATION_API_KEY='<chave-fornecida-pelo-secret-manager>' \
APPLICATION_ROLE=application \
APPLICATION_SESSIONS=default \
APPLICATION_PERMISSIONS=messages:send,webhooks:manage \
npm run provision-application -- --apply
```

Execute `--apply` somente após validar que `MONGODB_URI` aponta para o banco Atlas exclusivo do Gateway. A operação é limitada à aplicação identificada, adiciona o hash sem substituir hashes existentes e não cria credenciais automaticamente. Se a aplicação já existir com sessões ou permissões diferentes, o script aborta; use `--allow-scope-change` somente após revisão explícita.

Para uma chave administrativa do painel, use uma chave nova e exclusiva, com escopo explícito das sessões necessárias:

```bash
APPLICATION_ID=gateway-admin \
APPLICATION_NAME=gateway-admin \
APPLICATION_API_KEY='<chave-gerada-no-secret-manager>' \
APPLICATION_ROLE=admin \
APPLICATION_SESSIONS=default \
APPLICATION_PERMISSIONS=sessions:read,sessions:connect \
npm run provision-application -- --dry-run
```

Revise o dry-run e execute `--apply` somente no serviço Gateway, com `MONGODB_URI` apontando para o Atlas de produção do Gateway. O comando é idempotente para a mesma chave; não reutilize chaves locais ou de homologação e não coloque o valor em argumentos persistentes, commits ou logs.

## Backend req-services

O backend deve usar sua própria conexão Atlas e receber a URL pública HTTPS do Gateway apenas por configuração. Configure:

- `WHATSAPP_ENABLED=false` durante a primeira implantação e validação do backend.
- `WHATSAPP_API_URL` para a URL HTTPS do Gateway.
- `WHATSAPP_API_KEY` com uma chave exclusiva e escopo mínimo.
- `WHATSAPP_APPLICATION_ID` e `WHATSAPP_SESSION_ID` conforme a associação cadastrada.
- `WHATSAPP_WEBHOOK_SECRET` com o mesmo segredo cadastrado no Gateway.
- `WHATSAPP_APPROVAL_GROUP_ID` com o JID exato do grupo autorizado.
- `WHATSAPP_REQUEST_TIMEOUT_MS` com limite explícito.

Cadastre o webhook somente depois que o backend estiver disponível via HTTPS. A assinatura HMAC deve ser validada sobre o corpo bruto, junto com timestamp, `eventId`, aplicação, sessão e grupo.

O comando de inicialização é `npm start`. Mantenha `WHATSAPP_ENABLED=false` no primeiro deploy. O backend deve usar sua porta Railway, a URI Atlas produtiva existente e seus segredos próprios; não reutilize a URI do Gateway.

## Frontend e Telegram

Para o frontend, use `npm ci`, `npm run build` e publique `dist` como conteúdo estático. Configure apenas `VITE_API_URL` com a URL pública HTTPS do backend; nenhuma API key ou segredo WhatsApp deve chegar ao bundle.

Para o Telegram, use `npm ci` e `npm start` somente no serviço que já possuir o token configurado. Preserve `TELEGRAM_NOTIFICATIONS_ENABLED` no backend e não inicie uma segunda instância com o mesmo token durante a migração.

## Variáveis por serviço

| Serviço | Obrigatórias | Opcionais / operação | Homologação |
| --- | --- | --- | --- |
| Gateway | `NODE_ENV=production`, `MONGODB_URI`, `WEBHOOK_ENCRYPTION_KEY`, API key provisionada no MongoDB; `PORT` é injetada pelo Railway | `WHATSAPP_AUTH_DIR=/data/auth`, `WHATSAPP_SESSION_AUTH_ROOT=/data/auth-sessions`, `WHATSAPP_SESSION_LOCK_ROOT=/data/.session-locks`, `WHATSAPP_MONITOR_MODE`, `WHATSAPP_MONITORED_GROUPS`, `WHATSAPP_DEFAULT_APPLICATION_ID`, `WHATSAPP_AUTO_CONNECT` | `WEBHOOK_ALLOW_LOCAL_TEST` deve ser ausente/false; não usar `WEBHOOK_LOCAL_TEST_*` |
| Backend | `MONGO_URI`, `JWT_SECRET`, `INTERNAL_TOKEN`, `PORT` | `CORS_ORIGIN`, Telegram, `WHATSAPP_*` | `TEST_MONGODB_URI`, porta 3005 e `.env.homologation` |
| Frontend | `VITE_API_URL` | nenhuma credencial de serviço | URL local ou backend de homologação |
| Telegram | `BOT_TOKEN`, `BASE_URL`, `INTERNAL_TOKEN`, `CHAT_ID`, `AUTHORIZED_USERS`, `PORT` | `NODE_ENV` | token e porta exclusivos de homologação |

Os valores reais devem ser cadastrados no secret manager do Railway. A tabela não autoriza reutilizar segredos de homologação ou produção entre serviços.

## Índices e inicialização

Antes de liberar tráfego em um banco novo, execute o provisionamento explícito em modo de inspeção e, após revisão, em modo autorizado:

```bash
npm run initialize-indexes -- --dry-run
npm run initialize-indexes -- --apply
```

Em banco existente, use a migração específica de mensagens quando o dry-run identificar o índice sparse legado. Não use `syncIndexes`, `dropIndexes` ou migrações automáticas no boot. `autoIndex` permanece desabilitado.

## Atualização e rollback

1. Publique uma versão compatível sem ativar a integração WhatsApp no backend.
2. Valide `/health`, `/ready`, conexão Atlas e volume persistente.
3. Provisione e confira os índices.
4. Cadastre o webhook HTTPS e valide HMAC com um receptor controlado.
5. Ative `WHATSAPP_ENABLED=true` no backend gradualmente.
6. Monitore deliveries, eventos processados, erros HTTP e status dos pedidos.
7. Em caso de falha, desative a integração no backend, preserve os pedidos e reverta apenas a versão da aplicação. Não apague a sessão nem suas credenciais.

O rollback não deve executar reset de banco, apagar mensagens ou remover o volume de autenticação. Eventos WhatsApp possuem entrega pelo menos uma vez; o backend deve continuar deduplicando por `eventId`.

## Rotação e observabilidade

Rotacione API keys, segredos HMAC, `WEBHOOK_ENCRYPTION_KEY` e tokens de serviços por procedimento controlado, mantendo a janela de compatibilidade necessária. Nunca registre valores dessas variáveis.

Colete apenas métricas e logs operacionais: disponibilidade, latência, HTTP status, quantidade de tentativas e códigos de erro sanitizados. Não registre conteúdo integral de mensagens, payloads brutos, credenciais ou chaves Baileys.

## Limitações conhecidas

- A entrega de webhook é pelo menos uma vez; consumidores precisam deduplicar por `eventId`.
- Persistência da mensagem e publicação do evento não formam uma transação distribuída.
- Uma falha entre envio ao WhatsApp e persistência da associação pode deixar uma notificação órfã; ela não autoriza operações sem associação persistida.
- O Gateway serializa requisições concorrentes com a mesma `Idempotency-Key` dentro de uma instância e rejeita a reutilização com conteúdo diferente. Isso não substitui uma garantia distribuída entre réplicas nem resolve o caso em que o WhatsApp aceita o envio e o processo cai antes da persistência; não repetir cegamente requisições cujo resultado seja desconhecido.
- Uma sessão Baileys deve permanecer em uma única instância.

