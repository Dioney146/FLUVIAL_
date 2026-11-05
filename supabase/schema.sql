-- =====================================================================
--  Controle Fluvial Delly's — estrutura do banco (Supabase / Postgres)
--  Rode este arquivo inteiro em: Supabase > SQL Editor > New query > Run
-- =====================================================================

-- Base de pedidos (substituída a cada importação)
create table if not exists public.pedidos (
  numped          bigint primary key,
  codcli          bigint,
  cliente         text,
  vendedor        text,
  supervisor      text,
  cidade          text,
  data_pedido     date,
  rota            text,
  valor           numeric(14,2) default 0,
  qtd_itens       integer default 0,
  peso            numeric(14,3) default 0,
  obs             jsonb default '[]'::jsonb,   -- todas as colunas OBS* da base
  embarcacao_base text,                         -- se um dia a base trouxer coluna própria
  data_base       date,
  importado_em    timestamptz default now()
);

-- Municípios x portos (substituída a cada importação)
create table if not exists public.portos (
  id           bigserial primary key,
  municipio    text not null,
  porto        text not null,
  carga        text not null check (carga in ('FLUVIAL-RDW','FLUVIAL-DP')),
  importado_em timestamptz default now()
);

-- Ajustes manuais de embarcação/data (NÃO são apagados ao importar nova base)
create table if not exists public.ajustes (
  numped         bigint primary key,
  embarcacao     text,
  data_prevista  date,
  observacao     text,
  atualizado_em  timestamptz default now(),
  atualizado_por text
);

-- Embarcações conhecidas (o site aprende novas a cada ajuste manual)
create table if not exists public.embarcacoes (
  nome      text primary key,
  criado_em timestamptz default now()
);

-- Mapeamento manual de municípios que não casaram com a planilha de portos
create table if not exists public.mapeamento_municipios (
  cidade        text primary key,              -- chave normalizada (sem acento/espaço)
  cidade_nome   text,
  carga         text not null check (carga in ('FLUVIAL-RDW','FLUVIAL-DP','IGNORAR')),
  porto         text,
  atualizado_em timestamptz default now()
);

-- Histórico de importações
create table if not exists public.importacoes (
  id        bigserial primary key,
  tipo      text not null,      -- 'pedidos' | 'portos'
  arquivo   text,
  linhas    integer,
  usuario   text,
  criado_em timestamptz default now()
);

-- ---------------------------------------------------------------------
-- Segurança: só usuários logados (Supabase Auth) leem e gravam
-- ---------------------------------------------------------------------
alter table public.pedidos               enable row level security;
alter table public.portos                enable row level security;
alter table public.ajustes               enable row level security;
alter table public.embarcacoes           enable row level security;
alter table public.mapeamento_municipios enable row level security;
alter table public.importacoes           enable row level security;

do $$
declare t text;
begin
  foreach t in array array['pedidos','portos','ajustes','embarcacoes','mapeamento_municipios','importacoes'] loop
    execute format('drop policy if exists "logados_%1$s" on public.%1$I', t);
    execute format('create policy "logados_%1$s" on public.%1$I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Embarcações iniciais
-- ---------------------------------------------------------------------
insert into public.embarcacoes (nome) values
  ('VOVÓ JOVEM'),('RAINHA ESTER'),('LEÃO DE JUDÁ X'),('LEÃO DE JUDÁ'),('MADAME CRYS 1'),('PRÍNCIPE JOSÉ'),
  ('BALSA VERMELHA'),('M GOMES'),('TITO NOGUEIRA'),('L TORRES'),('INGRID BEATRIZ'),('IRMÃO TORRES'),
  ('DONA SULA'),('MAYTE SAFIRA'),('GM OLIVEIRA'),('EMBAIXADOR'),('ESMERALDA'),('DEUS DE ALIANÇA'),('OLIVEIRA')
on conflict (nome) do nothing;
