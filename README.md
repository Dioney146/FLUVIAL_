# ⛴ Controle Fluvial · Delly's

Site para conferir e organizar os pedidos do interior atendidos por **transporte fluvial**:

1. **Pendências**: pedidos fluviais sem embarcação e/ou data, com filtro por vendedor, município, carga e status, e mensagem pronta para WhatsApp por vendedor.
2. **Direcionamento automático**: município → `FLUVIAL-RDW` (PORTO RODWAY) ou `FLUVIAL-DP` (PORTO DEMETRIO, ESCADARIA e SÃO RAIMUNDO).
3. **Montagem de cargas**: pedidos agrupados por carga › município › embarcação › data, com outras ordens de agrupamento e exportação para Excel.
4. **Importação**: sobe a base de pedidos (.xls/.xlsx) e a planilha de municípios e portos. Tudo é recalculado na hora.

Stack: **HTML + JS puro** (sem build) · **Supabase** (banco + login) · **Vercel** (hospedagem) · **GitHub**.

---

## Estrutura

```
index.html            telas do site
css/style.css         visual
js/config.js          ← URL e chave do Supabase
js/core.js            motor: leitura das planilhas, casamento de municípios, leitura de embarcação/data nas OBS
js/store.js           gravação no Supabase (ou no navegador, em modo local)
js/app.js             interface
supabase/schema.sql   tabelas e segurança do banco
vercel.json
```

---

## Passo a passo

### 1. Testar sem banco (opcional)
Com `js/config.js` vazio, o site roda em **modo local**: os dados ficam só no seu navegador.
```bash
cd controle-fluvial
python -m http.server 8000
# abra http://localhost:8000
```
> Não funciona abrindo o `index.html` com duplo clique. Os módulos JS precisam de um servidor (o Python acima ou o Live Server do VS Code).

### 2. Supabase
1. Crie um projeto em https://supabase.com.
2. **SQL Editor → New query**: cole todo o conteúdo de `supabase/schema.sql` e clique em **Run**.
3. **Authentication → Users → Add user → Create new user**: crie o e-mail e a senha de quem vai usar (marque *Auto Confirm User*).
4. **Project Settings → API**: copie a **Project URL** e a **anon public key** para o `js/config.js`:
   ```js
   export const SUPABASE_URL = 'https://xxxxxxxx.supabase.co';
   export const SUPABASE_ANON_KEY = 'eyJhbGciOi...';
   ```
   A *anon key* pode ficar no código. Quem protege os dados é o RLS: só usuário logado lê ou grava.

### 3. GitHub
```bash
git init
git add .
git commit -m "Controle Fluvial"
git branch -M main
git remote add origin https://github.com/SEU_USUARIO/controle-fluvial.git
git push -u origin main
```
O `.gitignore` já impede subir planilhas (.xls/.xlsx) com dados de clientes.

### 4. Vercel
**Add New → Project → Import** o repositório. Framework: **Other**. Não há build command nem output directory, então é só clicar em **Deploy**.
Cada `git push` publica uma nova versão.

---

## Regras de negócio

### Carga por município
| Coluna da planilha de portos | Carga |
|---|---|
| PORTO RODWAY | `FLUVIAL-RDW` |
| PORTO DEMETRIO / PORTO ESCADARIA / PORTO SÃO RAIMUNDO | `FLUVIAL-DP` |

Os nomes não precisam ser idênticos aos da base: `S.A. do Içá` = `SANTO ANTONIO DO ICA`, `B. Constant` = `BENJAMIN CONSTANT`, `Sta Isabel` = `SANTA ISABEL DO RIO NEGRO`. Erros de digitação leves também são reconhecidos (`Uricurituba` = `URUCURITUBA`).
A aba **Municípios** mostra como cada cidade foi reconhecida. Se uma cidade da rota *INTERIOR FLUVIAL* não estiver na planilha, ela aparece em destaque e você define a carga com um clique.

### Embarcação e data
A base **não tem colunas próprias**: o vendedor escreve nas OBS (`OBS`, `OBS1`, `OBS2`, `OBSENTREGA1–3`). O site:
- ignora códigos numéricos e "HORARIO COMERCIAL" e junta os textos sem repetição;
- **embarcação**: procura nomes da lista de embarcações conhecidas e padrões como "Barco X", "Balsa X", "F B X", "N/M X";
- **data**: lê `dd/mm` dando preferência à data de **saída/embarque** (e não à de chegada), além de "dia 10" e dias da semana ("sai terça", "3ª feira").

Se um dia a base trouxer colunas `EMBARCACAO` e `DATA EMBARQUE`, elas passam a ser usadas no lugar das OBS.

### Status
| Status | Quando |
|---|---|
| **SEM EMBARCAÇÃO E DATA** / **SEM EMBARCAÇÃO** / **SEM DATA** | falta informação → acionar o vendedor |
| **A CONFERIR** | tem as duas informações, mas alguma foi deduzida: "barco da vez", mais de uma embarcação citada, data a partir de dia da semana, ou herdada de outro pedido do mesmo cliente (pedido desmembrado) |
| **COMPLETO** | embarcação e data claras, ou confirmadas manualmente |

### Ajustes manuais
Em **Pendências** dá para editar um pedido (botão *Editar* ou duplo clique), confirmar com ✓ ou selecionar vários e aplicar embarcação e data de uma vez.
Os ajustes ficam na tabela `ajustes` e **continuam valendo quando você importa uma base nova**. Toda embarcação digitada entra na lista de embarcações conhecidas, então o site aprende os nomes com o uso.
