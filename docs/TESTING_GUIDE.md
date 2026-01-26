# 🧪 GUIA DE TESTES - NyxChronos v1.0.0

## 📑 Índice

1. [Testes Manuais](#testes-manuais)
2. [Testes de Funcionalidade](#testes-de-funcionalidade)
3. [Testes de Performance](#testes-de-performance)
4. [Testes de Segurança](#testes-de-segurança)
5. [Checklist de Deployment](#checklist-de-deployment)

---

## 🔄 Testes Manuais

### Teste 1: Inicialização do Bot

**Objetivo**: Verificar se o bot inicia corretamente

**Passos**:
1. Execute `node bot.js`
2. Aguarde até ver "Bot online" no console
3. Verifique se aparece em "online" no Discord

**Resultado Esperado**:
```
✅ Bot aparece online em ~2-3 segundos
✅ Console mostra "Bot online"
✅ Sem erros de conexão
```

**Tempo**: 1 min

---

### Teste 2: Resposta a Slash Command

**Objetivo**: Verificar resposta básica de comando

**Passos**:
1. Abra Discord
2. Vá para servidor configurado
3. Digite `/ajudar`
4. Veja a resposta

**Resultado Esperado**:
```
✅ Comando responde em <1 segundo
✅ Mensagem é uma embed formatada
✅ Sem erros no console
```

**Tempo**: 2 min

---

### Teste 3: Conexão MongoDB

**Objetivo**: Verificar conexão com banco de dados

**Passos**:
1. Configure .env com MONGODB_URI
2. Execute `node bot.js`
3. Execute qualquer comando que acesse BD

**Resultado Esperado**:
```
✅ Comando funciona sem erro de conexão
✅ Dados são salvos no MongoDB
✅ Queries executam em <500ms
```

**Tempo**: 2 min

---

### Teste 4: Google Sheets Integration

**Objetivo**: Verificar sincronização com Google Sheets

**Passos**:
1. Configure service account
2. Execute `/planilha`
3. Verifique planilha no Google Sheets

**Resultado Esperado**:
```
✅ Dados aparecem na planilha
✅ Formato está correto
✅ Timestamp é registrado
```

**Tempo**: 3 min

---

### Teste 5: Rate Limiting

**Objetivo**: Verificar proteção contra spam

**Passos**:
1. Execute o mesmo comando 15 vezes em 1 minuto
2. Verifique resposta

**Resultado Esperado**:
```
✅ Após limite, recebe mensagem de rate limit
✅ Servidor continua estável
✅ Nenhum crash
```

**Tempo**: 2 min

---

### Teste 6: Graceful Shutdown

**Objetivo**: Verificar encerramento seguro

**Passos**:
1. Bot rodando
2. Pressione Ctrl+C
3. Verifique logs

**Resultado Esperado**:
```
✅ Notificação enviada ao servidor
✅ Conexões fechadas corretamente
✅ Processo finaliza em <3 segundos
```

**Tempo**: 1 min

---

## ✅ Testes de Funcionalidade

### Teste 7: /ponto - Iniciar Ponto

**Passos**:
1. `/ponto` (iniciar)
2. Verificar resposta

**Validações**:
- [ ] Responde com sucesso
- [ ] Cria documento no MongoDB
- [ ] Status = "iniciado"
- [ ] Registra timestamp correto
- [ ] Tempo < 400ms

---

### Teste 8: /ponto - Finalizar Ponto

**Passos**:
1. Após iniciar ponto
2. `/ponto` novamente (finalizar)
3. Verificar resultado

**Validações**:
- [ ] Marca como finalizado
- [ ] Calcula tempo total
- [ ] Salva no MongoDB
- [ ] Resposta clara

---

### Teste 9: /horas - Ver Total

**Passos**:
1. Execute `/horas`
2. Verifique resposta

**Validações**:
- [ ] Mostra total de horas
- [ ] Formato MM:HH:SS correto
- [ ] Agrega dados corretamente
- [ ] Tempo < 300ms

---

### Teste 10: /top - Ranking

**Passos**:
1. Execute `/top`
2. Verifique lista

**Validações**:
- [ ] Ordena por horas DESC
- [ ] Mostra top 10
- [ ] Formata bem
- [ ] Tempo < 600ms

---

### Teste 11: /cancelar - Desfazer

**Passos**:
1. Inicie ponto
2. `/cancelar`
3. Verifique

**Validações**:
- [ ] Remove último ponto
- [ ] Atualiza total de horas
- [ ] Sem cooldown
- [ ] Tempo < 200ms

---

### Teste 12: /painel - Admin

**Passos**:
1. Use comando `/painel`
2. Verifique permissões

**Validações**:
- [ ] Só admin pode usar
- [ ] Mostra opções de config
- [ ] Permite editar settings
- [ ] Valida permissões

---

## ⚡ Testes de Performance

### Teste 13: Tempo Médio de Resposta

**Objetivo**: Medir velocidade de cada comando

**Procedimento**:
```
Para cada comando:
1. Execute 10 vezes
2. Registre tempo de cada
3. Calcule média
```

**Resultado Esperado**:
```
/ponto:        200-400ms (média 300ms) ✅
/horas:        150-300ms (média 225ms) ✅
/top:          300-600ms (média 450ms) ✅
/cancelar:     100-200ms (média 150ms) ✅
Geral:         370ms (média)            ✅
```

---

### Teste 14: Carga de Requisições

**Objetivo**: Testar com múltiplas requisições simultâneas

**Procedimento**:
```
1. Simule 50 usuarios
2. Cada um executa comando
3. Meça tempo de resposta
4. Verifique estabilidade
```

**Resultado Esperado**:
```
✅ Sem timeouts
✅ Sem crashes
✅ Latência <1000ms
✅ Sem perda de dados
```

---

### Teste 15: Uso de Memória

**Objetivo**: Verificar vazamento de memória

**Procedimento**:
1. Bot rodando 1 hora
2. Monite memória em tempo real
3. Verifique crescimento

**Resultado Esperado**:
```
✅ Começa: ~150MB
✅ Depois 1h: ~180MB (estável)
✅ Sem crescimento contínuo
```

---

### Teste 16: Queries de Banco de Dados

**Objetivo**: Performance das queries

**Procedimento**:
1. Execute `/top` com 10k documentos
2. Meça tempo

**Resultado Esperado**:
```
✅ Tempo < 500ms
✅ Índices estão otimizados
✅ Sem N+1 queries
```

---

## 🔒 Testes de Segurança

### Teste 17: SQL Injection

**Objetivo**: Verificar proteção contra injection

**Procedimento**:
1. Tente input malicioso: `'; DROP TABLE users; --`
2. Execute comando
3. Verifique resultado

**Resultado Esperado**:
```
✅ Input é sanitizado
✅ Nenhuma execução de comando
✅ Erro tratado gracefully
```

---

### Teste 18: Rate Limit Bypass

**Objetivo**: Tentar contornar rate limit

**Procedimento**:
1. Tente usar múltiplas contas
2. Execute rapidamente
3. Verifique proteção

**Resultado Esperado**:
```
✅ Global limit ativa (500 req/min)
✅ Per-user limits funcionam
✅ Registro em logs
```

---

### Teste 19: Permissões de Admin

**Objetivo**: Verificar proteção de dados admin

**Procedimento**:
1. Usuário não-admin tenta `/painel`
2. Verifique acesso

**Resultado Esperado**:
```
✅ Acesso negado
✅ Mensagem clara
✅ Registrado em logs
```

---

### Teste 20: Validação de Entrada

**Objetivo**: Testar filtros de input

**Procedimento**:
1. Tente inputs inválidos
2. XSS: `<script>alert('xss')</script>`
3. Command injection

**Resultado Esperado**:
```
✅ Todos rejeitados
✅ Sem execução de código
✅ Mensagens de erro claras
```

---

## 📋 Checklist de Deployment

### Pré-Deployment
- [ ] Todos os 20 testes passam
- [ ] Sem erros no console
- [ ] Performance aceitável
- [ ] Segurança validada
- [ ] Documentação atualizada

### Configuração
- [ ] .env configurado corretamente
- [ ] MongoDB conexão funcionando
- [ ] Google Sheets credenciais OK
- [ ] Discord token válido
- [ ] Permissões de guild corretas

### Testes Finais
- [ ] `/ponto` funciona
- [ ] `/horas` mostra dados
- [ ] `/top` retorna ranking
- [ ] `/painel` restrito a admin
- [ ] `/planilha` sincroniza

### Monitoramento
- [ ] Logs sendo registrados
- [ ] Erros são notificados
- [ ] Performance monitorada
- [ ] Uptime verificado

### Pós-Deployment
- [ ] Bot online em Discord
- [ ] Comandos respondendo
- [ ] Dados sincronizando
- [ ] Sem erros em logs
- [ ] Stakeholders notificados

---

## 🎯 Matriz de Testes

| Teste | Tipo | Status | Tempo | Critico |
|-------|------|--------|-------|----------|
| 1 | Manual | ✅ | 1 min | 🔴 Sim |
| 2 | Manual | ✅ | 2 min | 🔴 Sim |
| 3 | Manual | ✅ | 2 min | 🔴 Sim |
| 4 | Manual | ✅ | 3 min | 🟡 Sim |
| 5 | Manual | ✅ | 2 min | 🟡 Sim |
| 6 | Manual | ✅ | 1 min | 🟡 Não |
| 7-12 | Function | ✅ | 15 min | 🔴 Sim |
| 13-16 | Perf | ✅ | 20 min | 🟡 Não |
| 17-20 | Security | ✅ | 15 min | 🔴 Sim |

---

## ⏱️ Tempo Total

```
Testes Manuais:        15 min
Testes Funcionais:     15 min
Testes Performance:    20 min
Testes Segurança:      15 min
Deployment Checklist:  10 min
─────────────────────────────
TOTAL:                 75 min (~1h 15 min)
```

---

## 📝 Recomendações

### ✅ Fazer Antes de Cada Deploy
1. Rodar testes manuais (15 min)
2. Validar funcionalidades críticas
3. Verificar segurança
4. Confirmar checklist

### 🎓 Para Desenvolvimento
1. Adicionar testes unitários (jest)
2. Adicionar testes integração
3. CI/CD pipeline
4. Cobertura 100%

### 🚀 Para Produção
1. Monitoramento contínuo
2. Alertas de erro
3. Backup automático
4. Disaster recovery

---

## 🎉 Conclusão

Com estes testes, você pode ter **confiança total** no deploy do NyxChronos para produção.

**Status**: Pronto para Produção ✅

---

**Data**: 25 de Janeiro de 2026  
**Versão**: 1.0.0  
**Testado por**: Foxy Apollyon
